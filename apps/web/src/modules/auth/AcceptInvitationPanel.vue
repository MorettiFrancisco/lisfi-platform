<script setup lang="ts">
import { ref } from 'vue';
import { adminInvitationAcceptSchema } from '@lisfi/shared';
import { postAuth } from './api';
const emit = defineEmits<{ created: [email: string]; cancel: [] }>();
const name = ref('');
const email = ref('');
const password = ref('');
const confirmation = ref('');
const token = ref('');
const busy = ref(false);
const error = ref('');
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
    await postAuth('/api/admin-invitations/accept', parsed.data);
    emit('created', parsed.data.email);
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
      Ingresá el correo y la clave que recibiste. Después deberás configurar la
      autenticación de dos pasos.
    </p>
    <p v-if="error" role="alert">{{ error }}</p>
    <form @submit.prevent="accept">
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
