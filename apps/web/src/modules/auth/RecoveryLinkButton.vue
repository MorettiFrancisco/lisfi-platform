<script setup lang="ts">
import { ref } from 'vue';
import { postAuth } from './api';
const props = defineProps<{ userId: string; name: string }>();
const link = ref('');
const error = ref('');
const busy = ref(false);
async function create() {
  if (
    busy.value ||
    !window.confirm(
      `Confirmá que verificaste la identidad y el número de WhatsApp de ${props.name}.`,
    )
  )
    return;
  busy.value = true;
  error.value = '';
  link.value = '';
  try {
    const result = (await postAuth('/api/recovery-links', {
      userId: props.userId,
    })) as { token: string };
    link.value = `${window.location.origin}/#recover=${result.token}`;
  } catch {
    error.value =
      'No se pudo generar el enlace. Verificá tus permisos y la cuenta.';
  } finally {
    busy.value = false;
  }
}
</script>
<template>
  <div>
    <button type="button" class="secondary" :disabled="busy" @click="create">
      Recuperar acceso de {{ name }}
    </button>
    <p v-if="error" role="alert">{{ error }}</p>
    <div v-if="link">
      <label :for="`recovery-link-${userId}`"
        >Enlace de recuperación para {{ name }}</label
      >
      <input
        :id="`recovery-link-${userId}`"
        :value="link"
        readonly
        @focus="($event.target as HTMLInputElement).select()"
      />
      <p>
        Compartilo solo con la persona verificada. Vence en una hora y funciona
        una sola vez.
      </p>
    </div>
  </div>
</template>
