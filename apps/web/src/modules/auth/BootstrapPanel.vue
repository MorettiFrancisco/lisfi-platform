<script setup lang="ts">
import { ref } from 'vue';
import { bootstrapRequestSchema } from '@lisfi/shared';
import { AuthRequestError, postAuth } from './api';

const emit = defineEmits<{ created: [email: string]; cancel: [] }>();
const name = ref('');
const email = ref('');
const password = ref('');
const confirmation = ref('');
const token = ref('');
const busy = ref(false);
const error = ref('');

async function createAdministrator() {
  if (busy.value) return;
  error.value = '';
  const parsed = bootstrapRequestSchema.safeParse({
    name: name.value,
    email: email.value,
    password: password.value,
  });
  if (!parsed.success) {
    error.value =
      'Completá tu nombre, un correo válido y una contraseña de entre 12 y 128 caracteres.';
    return;
  }
  if (password.value !== confirmation.value) {
    error.value = 'Las contraseñas no coinciden.';
    return;
  }
  busy.value = true;
  try {
    await postAuth('/api/bootstrap', parsed.data, {
      'X-Bootstrap-Token': token.value.trim(),
    });
    emit('created', parsed.data.email);
  } catch (cause) {
    const status = cause instanceof AuthRequestError ? cause.status : 0;
    error.value =
      status === 409
        ? 'El alta inicial ya se completó o ese correo ya tiene una cuenta. Intentá ingresar.'
        : status === 403
          ? 'La clave de alta no es válida. Revisala e intentá nuevamente.'
          : status === 404
            ? 'El alta inicial está deshabilitada o la clave venció. Contactá al responsable de la instalación.'
            : status === 429
              ? 'Demasiados intentos. Esperá un minuto antes de volver a intentar.'
              : 'No pudimos confirmar el alta. Si la conexión se interrumpió, intentá ingresar con los datos elegidos antes de repetirla.';
  } finally {
    password.value = '';
    confirmation.value = '';
    token.value = '';
    busy.value = false;
  }
}
</script>

<template>
  <div :aria-busy="busy">
    <p>
      Este paso se realiza una sola vez. Necesitás la clave temporal del
      responsable de la instalación. Después de crear tu cuenta, deberás
      configurar la autenticación de dos pasos.
    </p>
    <p v-if="error" role="alert">{{ error }}</p>
    <form @submit.prevent="createAdministrator">
      <label for="admin-name">Nombre completo</label>
      <input
        id="admin-name"
        v-model="name"
        autocomplete="name"
        maxlength="100"
        required
        :disabled="busy"
      />
      <label for="admin-email">Correo electrónico</label>
      <input
        id="admin-email"
        v-model="email"
        type="email"
        autocomplete="username"
        maxlength="254"
        required
        :disabled="busy"
      />
      <label for="admin-password">Contraseña nueva</label>
      <input
        id="admin-password"
        v-model="password"
        type="password"
        autocomplete="new-password"
        minlength="12"
        maxlength="128"
        required
        :disabled="busy"
      />
      <label for="admin-confirmation">Repetí la contraseña</label>
      <input
        id="admin-confirmation"
        v-model="confirmation"
        type="password"
        autocomplete="new-password"
        minlength="12"
        maxlength="128"
        required
        :disabled="busy"
      />
      <label for="bootstrap-token">Clave temporal de alta</label>
      <input
        id="bootstrap-token"
        v-model="token"
        type="password"
        autocomplete="off"
        maxlength="64"
        required
        :disabled="busy"
      />
      <button :disabled="busy">
        {{ busy ? 'Creando cuenta…' : 'Crear administrador' }}
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
