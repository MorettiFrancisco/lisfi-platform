<script setup lang="ts">
import { ref } from 'vue';
import { adminInvitationRequestSchema } from '@lisfi/shared';
import { postAuth } from './api';
const email = ref('');
const token = ref('');
const expiresAt = ref('');
const busy = ref(false);
const error = ref('');

async function create() {
  const parsed = adminInvitationRequestSchema.safeParse({ email: email.value });
  if (!parsed.success || busy.value) {
    error.value = 'Ingresá un correo válido.';
    return;
  }
  error.value = '';
  token.value = '';
  busy.value = true;
  try {
    const result = (await postAuth('/api/admin-invitations', parsed.data)) as {
      token: string;
      expiresAt: string;
    };
    token.value = result.token;
    expiresAt.value = result.expiresAt;
  } catch {
    error.value =
      'No se pudo crear la invitación. Verificá tus permisos e intentá nuevamente.';
  } finally {
    busy.value = false;
  }
}
</script>
<template>
  <section aria-labelledby="invite-title">
    <h3 id="invite-title">Invitar administrador</h3>
    <p>
      La clave es de un solo uso y vence en una hora. Compartila por un canal
      privado junto con el correo indicado.
    </p>
    <form @submit.prevent="create">
      <label for="invitation-email">Correo de la persona invitada</label>
      <input
        id="invitation-email"
        v-model="email"
        type="email"
        required
        :disabled="busy"
      />
      <button :disabled="busy">Generar invitación</button>
    </form>
    <p v-if="error" role="alert">{{ error }}</p>
    <div v-if="token">
      <label for="invitation-token">Clave de invitación</label>
      <input
        id="invitation-token"
        :value="token"
        readonly
        @focus="($event.target as HTMLInputElement).select()"
      />
      <p>
        Vence: {{ new Date(expiresAt).toLocaleString() }}. Copiala ahora: no se
        puede recuperar después.
      </p>
    </div>
  </section>
</template>
