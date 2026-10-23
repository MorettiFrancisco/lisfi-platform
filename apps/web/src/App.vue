<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { healthResponseSchema } from '@lisfi/shared';

const status = ref('Comprobando conexión…');
const loading = ref(false);

async function checkHealth() {
  loading.value = true;
  status.value = 'Comprobando conexión…';
  try {
    const response = await fetch('/api/health', {
      signal: AbortSignal.timeout(5000),
    });
    if (!response.ok) throw new Error('API unavailable');
    healthResponseSchema.parse(await response.json());
    status.value = 'API conectada';
  } catch {
    status.value = 'No se pudo conectar con la API. Intentá nuevamente.';
  } finally {
    loading.value = false;
  }
}

onMounted(checkHealth);
</script>

<template>
  <main>
    <p class="eyebrow">Liga Infantil de Fútbol</p>
    <h1>LISFI Platform</h1>
    <p>Base de desarrollo de la plataforma de gestión.</p>
    <section aria-labelledby="connection-title">
      <h2 id="connection-title">Estado del servicio</h2>
      <p role="status">{{ status }}</p>
      <button :disabled="loading" @click="checkHealth">
        Verificar conexión
      </button>
    </section>
  </main>
</template>
