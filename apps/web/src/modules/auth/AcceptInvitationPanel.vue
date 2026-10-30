<script setup lang="ts">
import { ref } from 'vue';
import { adminInvitationAcceptSchema } from '@lisfi/shared';
import { postAuth } from './api';
const emit = defineEmits<{
  created: [email: string, kind?: 'PRESIDENT' | 'REPRESENTATIVE'];
  cancel: [];
  existing: [];
  acceptedExisting: [kind: 'PRESIDENT' | 'REPRESENTATIVE'];
  switchAccount: [];
}>();
const props = withDefaults(
  defineProps<{
    kind?: 'admin' | 'representative';
    initialToken?: string;
    existingSession?: boolean;
    accountName?: string;
  }>(),
  { kind: 'admin', initialToken: '' },
);
const name = ref('');
const email = ref('');
const password = ref('');
const confirmation = ref('');
const token = ref(props.initialToken);
const busy = ref(false);
const error = ref('');
async function acceptExisting() {
  if (busy.value) return;
  busy.value = true;
  error.value = '';
  try {
    const result = (await postAuth(
      '/api/representative-invitations/accept-existing',
      {
        token: token.value.trim(),
      },
    )) as { kind: 'PRESIDENT' | 'REPRESENTATIVE' };
    token.value = '';
    emit('acceptedExisting', result.kind);
  } catch {
    error.value =
      'No se pudo aceptar el enlace. Comprobá que ingresaste con la cuenta invitada o pedí un enlace nuevo.';
  } finally {
    busy.value = false;
  }
}
async function accept() {
  if (busy.value) return;
  const parsed = adminInvitationAcceptSchema.safeParse({
    name: name.value,
    email: email.value,
    password: password.value,
    token: token.value.trim(),
  });
  if (!parsed.success || password.value !== confirmation.value) {
    error.value =
      'Revisá el nombre, correo, clave de invitación y contraseñas (12 a 128 caracteres).';
    return;
  }
  busy.value = true;
  error.value = '';
  try {
    const result = await postAuth(
      props.kind === 'admin'
        ? '/api/admin-invitations/accept'
        : '/api/representative-invitations/accept',
      parsed.data,
    );
    emit(
      'created',
      parsed.data.email,
      props.kind === 'representative'
        ? (result as { kind: 'PRESIDENT' | 'REPRESENTATIVE' }).kind
        : undefined,
    );
  } catch {
    error.value =
      'No se pudo aceptar la invitación. Verificá el correo y la clave o solicitá una nueva invitación.';
  } finally {
    password.value = '';
    confirmation.value = '';
    token.value = '';
    busy.value = false;
  }
}
</script>
<template>
  <div>
    <p>
      Ingresá el correo y la clave que recibiste.
      {{
        kind === 'admin'
          ? 'Después deberás configurar la autenticación de dos pasos.'
          : 'Si sos representante, el acceso requiere dos aprobaciones de la liga.'
      }}
    </p>
    <p v-if="error" role="alert">{{ error }}</p>
    <div v-if="kind === 'representative' && existingSession">
      <p>
        Vas a aceptar el enlace con la cuenta de {{ accountName }}. Los
        representantes necesitan dos aprobaciones de la liga; los presidentes
        quedan habilitados al aceptar la invitación de LISFI.
      </p>
      <button :disabled="busy" @click="acceptExisting">
        Aceptar con mi cuenta
      </button>
      <button
        type="button"
        class="secondary"
        :disabled="busy"
        @click="emit('switchAccount')"
      >
        Usar otra cuenta
      </button>
      <button
        type="button"
        class="secondary"
        :disabled="busy"
        @click="emit('cancel')"
      >
        Cancelar
      </button>
    </div>
    <form v-else @submit.prevent="accept">
      <label for="invite-name">Nombre completo</label>
      <input
        id="invite-name"
        v-model="name"
        autocomplete="name"
        required
        maxlength="100"
        :disabled="busy"
      />
      <label for="invite-email">Correo electrónico</label>
      <input
        id="invite-email"
        v-model="email"
        type="email"
        autocomplete="username"
        required
        :disabled="busy"
      />
      <label for="invite-password">Contraseña nueva</label>
      <input
        id="invite-password"
        v-model="password"
        type="password"
        autocomplete="new-password"
        minlength="12"
        maxlength="128"
        required
        :disabled="busy"
      />
      <label for="invite-confirm">Repetí la contraseña</label>
      <input
        id="invite-confirm"
        v-model="confirmation"
        type="password"
        autocomplete="new-password"
        required
        :disabled="busy"
      />
      <label for="invite-code">Clave de invitación</label>
      <input
        id="invite-code"
        v-model="token"
        type="password"
        autocomplete="off"
        maxlength="64"
        required
        :disabled="busy"
      />
      <button :disabled="busy">Crear cuenta</button>
      <button
        v-if="kind === 'representative'"
        type="button"
        class="secondary"
        :disabled="busy"
        @click="emit('existing')"
      >
        Ya tengo una cuenta
      </button>
      <button
        type="button"
        class="secondary"
        :disabled="busy"
        @click="emit('cancel')"
      >
        Volver al ingreso
      </button>
    </form>
  </div>
</template>
