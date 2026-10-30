<script setup lang="ts">
import { ref } from 'vue';
import { recoveryAcceptSchema } from '@lisfi/shared';
import { postAuth } from './api';
const props = defineProps<{ token: string }>();
const emit = defineEmits<{ complete: []; cancel: [] }>();
const password = ref('');
const confirmation = ref('');
const busy = ref(false);
const error = ref('');
async function reset() {
  if (busy.value) return;
  const parsed = recoveryAcceptSchema.safeParse({
    token: props.token,
    password: password.value,
  });
  if (!parsed.success || password.value !== confirmation.value) {
    error.value =
      'Revisá la contraseña (12 a 128 caracteres) y su confirmación.';
    return;
  }
  busy.value = true;
  error.value = '';
  try {
    await postAuth('/api/recovery-links/accept', parsed.data);
    emit('complete');
  } catch {
    error.value =
      'El enlace no es válido o venció. Solicitá uno nuevo a la liga.';
  } finally {
    password.value = '';
    confirmation.value = '';
    busy.value = false;
  }
}
</script>
<template>
  <div>
    <p>
      Elegí una contraseña nueva. Se cerrarán las sesiones anteriores y se
      conservará tu MFA si lo tenías activado.
    </p>
    <p v-if="error" role="alert">{{ error }}</p>
    <form @submit.prevent="reset">
      <label for="recovery-password">Contraseña nueva</label>
      <input
        id="recovery-password"
        v-model="password"
        type="password"
        autocomplete="new-password"
        minlength="12"
        maxlength="128"
        required
        :disabled="busy"
      />
      <label for="recovery-confirm">Repetí la contraseña</label>
      <input
        id="recovery-confirm"
        v-model="confirmation"
        type="password"
        autocomplete="new-password"
        required
        :disabled="busy"
      />
      <button :disabled="busy">Cambiar contraseña</button>
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
