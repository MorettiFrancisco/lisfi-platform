<script setup lang="ts">
import { computed, ref } from 'vue';
import QRCode from 'qrcode';
import { mfaEnrollmentSchema } from '@lisfi/shared';
import { AuthRequestError, postAuth } from './api';

const emit = defineEmits<{
  complete: [];
  expired: [];
  busy: [value: boolean];
}>();
const password = ref('');
const code = ref('');
const enrollment = ref<{ totpURI: string; backupCodes: string[] } | null>(null);
const qrImage = ref('');
const saved = ref(false);
const busy = ref(false);
const error = ref('');
const secret = computed(() =>
  enrollment.value
    ? new URL(enrollment.value.totpURI).searchParams.get('secret')
    : '',
);

function setBusy(value: boolean) {
  busy.value = value;
  emit('busy', value);
}
function report(cause: unknown, verifying: boolean) {
  const status = cause instanceof AuthRequestError ? cause.status : 0;
  if (status === 401) {
    enrollment.value = null;
    qrImage.value = '';
    emit('expired');
    return;
  }
  error.value =
    status === 429
      ? 'Demasiados intentos. Esperá un momento antes de volver a intentar.'
      : status === 400 || status === 403
        ? verifying
          ? 'El código no es válido. Revisá la hora de tu dispositivo e intentá con un código nuevo.'
          : 'No pudimos iniciar la configuración. Revisá tu contraseña; si ya activaste MFA en otra ventana, actualizá la página.'
        : 'No pudimos confirmar la operación. Comprobá tu conexión. Si acabás de verificar el código, volvé a ingresar para consultar el estado de tu cuenta.';
}
async function enable() {
  if (busy.value) return;
  setBusy(true);
  error.value = '';
  try {
    enrollment.value = mfaEnrollmentSchema.parse(
      await postAuth('/api/auth/two-factor/enable', {
        password: password.value,
        method: 'totp',
      }),
    );
    saved.value = false;
    // The secret never leaves this origin for rendering; no external QR service.
    qrImage.value = await QRCode.toDataURL(enrollment.value.totpURI, {
      width: 240,
      margin: 2,
    });
  } catch (cause) {
    report(cause, false);
  } finally {
    password.value = '';
    setBusy(false);
  }
}
async function verify() {
  if (busy.value || !saved.value) return;
  setBusy(true);
  error.value = '';
  try {
    await postAuth('/api/auth/two-factor/verify-totp', {
      code: code.value.trim(),
    });
    enrollment.value = null;
    qrImage.value = '';
    emit('complete');
  } catch (cause) {
    report(cause, true);
  } finally {
    code.value = '';
    setBusy(false);
  }
}
</script>

<template>
  <div class="mfa-setup" :aria-busy="busy">
    <h3>Configurá la autenticación de dos pasos</h3>
    <p v-if="error" role="alert">{{ error }}</p>
    <form v-if="!enrollment" @submit.prevent="enable">
      <p>
        Confirmá tu contraseña para vincular una aplicación de autenticación.
      </p>
      <label for="mfa-password">Contraseña actual</label>
      <input
        id="mfa-password"
        v-model="password"
        type="password"
        autocomplete="current-password"
        required
        :disabled="busy"
      />
      <button :disabled="busy">
        {{ busy ? 'Preparando…' : 'Configurar MFA' }}
      </button>
    </form>
    <form v-else @submit.prevent="verify">
      <p>
        <strong>1. Vinculá tu aplicación.</strong> Escaneá este QR con tu
        aplicación de autenticación.
      </p>
      <img
        v-if="qrImage"
        class="mfa-qr"
        :src="qrImage"
        alt="Código QR para configurar tu autenticador LISFI"
        width="240"
        height="240"
      />
      <details>
        <summary>Ingresar la clave manualmente</summary>
        <p>
          Agregá una cuenta LISFI con clave basada en tiempo, 6 dígitos y
          período de 30 segundos.
        </p>
        <code class="secret">{{ secret }}</code>
      </details>
      <p>
        <strong>2. Guardá tus códigos de recuperación.</strong> Cada código
        sirve una sola vez si perdés el acceso a tu aplicación. Guardalos en un
        lugar privado.
      </p>
      <ul class="recovery-codes">
        <li v-for="backup in enrollment.backupCodes" :key="backup">
          <code>{{ backup }}</code>
        </li>
      </ul>
      <p class="hint">
        Si salís antes de verificar, podés reiniciar la configuración. Se
        generarán una clave y códigos nuevos que reemplazarán los anteriores.
      </p>
      <label class="checkbox-label"
        ><input
          v-model="saved"
          type="checkbox"
          required
          :disabled="busy"
        />Guardé mis códigos de recuperación</label
      >
      <p>
        <strong>3. Confirmá la vinculación.</strong> Ingresá el código de tu
        aplicación para activar MFA.
      </p>
      <label for="enrollment-code">Código de activación</label>
      <input
        id="enrollment-code"
        v-model="code"
        inputmode="numeric"
        autocomplete="one-time-code"
        pattern="[0-9]{6}"
        maxlength="6"
        required
        :disabled="busy"
      />
      <button :disabled="busy || !saved">
        {{ busy ? 'Activando…' : 'Activar MFA' }}
      </button>
    </form>
  </div>
</template>
