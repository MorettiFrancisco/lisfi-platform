<script setup lang="ts">
import { onMounted, ref } from 'vue';
import RecoveryLinkButton from './RecoveryLinkButton.vue';
const props = defineProps<{ currentUserId: string }>();
const users = ref<{ id: string; name: string }[]>([]);
const error = ref('');
const busy = ref(false);
async function load() {
  try {
    const response = await fetch('/api/administrators', {
      credentials: 'same-origin',
      cache: 'no-store',
    });
    if (!response.ok) throw new Error();
    users.value = (
      (await response.json()) as { items: { id: string; name: string }[] }
    ).items;
  } catch {
    error.value = 'No se pudo cargar la administración de usuarios.';
  }
}
async function revoke(id: string, name: string) {
  if (
    busy.value ||
    !window.confirm(`¿Revocar el rol administrativo de ${name}?`)
  )
    return;
  busy.value = true;
  error.value = '';
  try {
    const response = await fetch(
      `/api/administrators/${encodeURIComponent(id)}`,
      { method: 'DELETE', credentials: 'same-origin' },
    );
    if (!response.ok) throw new Error();
    await load();
  } catch {
    error.value =
      'No se pudo revocar el rol. Actualizá la lista e intentá nuevamente.';
  } finally {
    busy.value = false;
  }
}
onMounted(load);
</script>
<template>
  <section aria-labelledby="administrators-title">
    <h3 id="administrators-title">Administradores de la liga</h3>
    <p v-if="error" role="alert">{{ error }}</p>
    <ul>
      <li v-for="user in users" :key="user.id">
        {{ user.name }}
        <RecoveryLinkButton :user-id="user.id" :name="user.name" />
        <button
          v-if="user.id !== props.currentUserId"
          type="button"
          class="secondary"
          :disabled="busy"
          @click="revoke(user.id, user.name)"
        >
          Revocar rol administrativo
        </button>
      </li>
    </ul>
  </section>
</template>
