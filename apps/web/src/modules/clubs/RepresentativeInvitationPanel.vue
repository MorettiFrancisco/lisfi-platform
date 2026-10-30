<script setup lang="ts">
import { ref } from 'vue';
import { representativeInvitationRequestSchema } from '@lisfi/shared';
import { postAuth } from '../auth/api';
const props = defineProps<{
  clubId: string;
  kind: 'PRESIDENT' | 'REPRESENTATIVE';
}>();
const email = ref('');
const link = ref('');
const busy = ref(false);
const error = ref('');
async function create() {
  const parsed = representativeInvitationRequestSchema.safeParse({
    clubId: props.clubId,
    email: email.value,
    kind: props.kind,
  });
  if (!parsed.success || busy.value) {
    error.value = 'Ingresá un correo válido.';
    return;
  }
  busy.value = true;
  error.value = '';
  link.value = '';
  try {
    const result = (await postAuth(
      '/api/representative-invitations',
      parsed.data,
    )) as { token: string };
    link.value = `${window.location.origin}/#representative-invitation=${result.token}`;
  } catch {
    error.value =
      'No se pudo generar la invitación. Verificá tus permisos y el estado del club.';
  } finally {
    busy.value = false;
  }
}
</script>
<template>
  <section aria-labelledby="representative-invite-title">
    <h4 id="representative-invite-title">
      Invitar {{ kind === 'PRESIDENT' ? 'presidente' : 'representante' }}
    </h4>
    <p>
      Confirmá la identidad y el número de WhatsApp de la persona antes de
      compartir el enlace.
      {{
        kind === 'REPRESENTATIVE'
          ? 'El acceso requiere dos aprobaciones de la liga.'
          : 'La aceptación habilita al presidente para este club.'
      }}
    </p>
    <p>
      Si la persona ya tiene cuenta, puede iniciar sesión y aceptar el enlace
      con esa misma cuenta.
    </p>
    <form @submit.prevent="create">
      <label for="representative-invite-email"
        >Correo de la persona invitada</label
      >
      <input
        id="representative-invite-email"
        v-model="email"
        type="email"
        required
        :disabled="busy"
      />
      <button :disabled="busy">Generar enlace</button>
    </form>
    <p v-if="error" role="alert">{{ error }}</p>
    <div v-if="link">
      <label for="representative-invite-link"
        >Enlace para compartir por WhatsApp</label
      >
      <input
        id="representative-invite-link"
        :value="link"
        readonly
        @focus="($event.target as HTMLInputElement).select()"
      />
      <p>
        El enlace vence en una hora y solo se puede usar una vez. Compartí
        también el correo indicado.
      </p>
    </div>
  </section>
</template>
