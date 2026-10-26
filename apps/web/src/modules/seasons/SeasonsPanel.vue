<script setup lang="ts">
import { onMounted, onUnmounted, ref } from 'vue';
import {
  seasonInputSchema,
  seasonsResponseSchema,
  type Season,
} from '@lisfi/shared';
defineProps<{ isLeagueAdmin: boolean }>();
const emit = defineEmits<{ expired: []; recheck: []; busy: [boolean] }>();
const items = ref<Season[]>([]);
const page = ref(1);
const total = ref(0);
const filter = ref('ALL');
const loading = ref(false);
const saving = ref(false);
const error = ref('');
const notice = ref('');
const showForm = ref(false);
const name = ref('');
const year = ref(new Date().getFullYear());
const startDate = ref('');
const endDate = ref('');
const confirm = ref<Season | null>(null);
const labels: Record<Season['status'], string> = {
  DRAFT: 'Borrador',
  ACTIVE: 'Activa',
  CLOSED: 'Cerrada',
};
function displayDate(value: string) {
  const [year, month, day] = value.split('-');
  return `${day}/${month}/${year}`;
}
async function api(path: string, method = 'GET', body?: unknown) {
  const response = await fetch(path, {
    method,
    credentials: 'same-origin',
    cache: 'no-store',
    signal: AbortSignal.timeout(10000),
    ...(body === undefined
      ? {}
      : {
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        }),
  });
  if (response.status === 401) {
    emit('expired');
    throw new Error('session');
  }
  if (response.status === 403) {
    emit('recheck');
    throw new Error('session');
  }
  if (response.status === 409) throw new Error('conflict');
  if (!response.ok) throw new Error('network');
  return response.json();
}
async function load(reset = false) {
  if (reset) page.value = 1;
  loading.value = true;
  error.value = '';
  try {
    const params = new URLSearchParams({
      page: String(page.value),
      pageSize: '10',
      status: filter.value,
    });
    const result = seasonsResponseSchema.parse(
      await api(`/api/seasons?${params}`),
    );
    items.value = result.items;
    total.value = result.total;
    if (page.value > 1 && !items.value.length) {
      page.value--;
      await load();
    }
  } catch (cause) {
    if (!(cause instanceof Error && cause.message === 'session'))
      error.value = 'No pudimos cargar las temporadas. Intentá nuevamente.';
  } finally {
    loading.value = false;
  }
}
async function create() {
  if (saving.value) return;
  const parsed = seasonInputSchema.safeParse({
    name: name.value,
    year: Number(year.value),
    startDate: startDate.value,
    endDate: endDate.value,
  });
  if (!parsed.success) {
    error.value =
      'Revisá el nombre, el año y las fechas. La fecha de fin no puede ser anterior al inicio.';
    return;
  }
  saving.value = true;
  emit('busy', true);
  error.value = '';
  notice.value = '';
  try {
    await api('/api/seasons', 'POST', parsed.data);
    name.value = '';
    startDate.value = '';
    endDate.value = '';
    showForm.value = false;
    filter.value = 'ALL';
    await load(true);
    notice.value = 'Temporada creada como borrador.';
  } catch (cause) {
    if (!(cause instanceof Error && cause.message === 'session'))
      error.value =
        'No pudimos crear la temporada. Revisá el listado antes de volver a intentar.';
  } finally {
    saving.value = false;
    emit('busy', false);
  }
}
async function transition() {
  if (!confirm.value || saving.value) return;
  const season = confirm.value;
  const next = season.status === 'DRAFT' ? 'ACTIVE' : 'CLOSED';
  saving.value = true;
  emit('busy', true);
  error.value = '';
  notice.value = '';
  try {
    await api(`/api/seasons/${encodeURIComponent(season.id)}/status`, 'PATCH', {
      from: season.status,
      to: next,
    });
    confirm.value = null;
    await load();
    notice.value =
      next === 'ACTIVE'
        ? 'Temporada activada.'
        : 'Temporada cerrada. El historial permanece disponible.';
  } catch (cause) {
    if (!(cause instanceof Error && cause.message === 'session')) {
      confirm.value = null;
      await load();
      error.value =
        cause instanceof Error && cause.message === 'conflict'
          ? 'La temporada cambió. Actualizá el listado antes de continuar.'
          : 'No pudimos cambiar el estado. Revisá el listado antes de volver a intentar.';
    }
  } finally {
    saving.value = false;
    emit('busy', false);
  }
}
onMounted(() => load());
onUnmounted(() => emit('busy', false));
</script>
<template>
  <section
    class="seasons-panel"
    aria-labelledby="seasons-title"
    :aria-busy="loading || saving"
  >
    <div class="section-heading">
      <div>
        <p class="eyebrow">Organización de la liga</p>
        <h2 id="seasons-title">Temporadas</h2>
      </div>
      <button
        v-if="isLeagueAdmin && !showForm"
        type="button"
        :disabled="saving"
        @click="
          showForm = true;
          error = '';
          notice = '';
        "
      >
        Nueva temporada
      </button>
    </div>
    <p>Consultá las temporadas y conservá el historial de cada año.</p>
    <p v-if="error" role="alert">{{ error }}</p>
    <p v-if="notice" class="success-message" role="status">{{ notice }}</p>
    <form
      v-if="showForm && isLeagueAdmin"
      class="club-editor"
      @submit.prevent="create"
    >
      <h3>Nueva temporada</h3>
      <label for="season-name">Nombre de la temporada</label
      ><input
        id="season-name"
        v-model="name"
        maxlength="120"
        required
        :disabled="saving"
      />
      <label for="season-year">Año</label
      ><input
        id="season-year"
        v-model.number="year"
        type="number"
        min="1900"
        max="2100"
        required
        :disabled="saving"
      />
      <label for="season-start">Fecha de inicio</label
      ><input
        id="season-start"
        v-model="startDate"
        type="date"
        required
        :disabled="saving"
      />
      <label for="season-end">Fecha de fin</label
      ><input
        id="season-end"
        v-model="endDate"
        type="date"
        required
        :disabled="saving"
      />
      <p class="hint">Se creará como borrador; después podrás activarla.</p>
      <div class="button-row">
        <button :disabled="saving">
          {{ saving ? 'Guardando…' : 'Crear borrador' }}</button
        ><button
          type="button"
          class="secondary"
          :disabled="saving"
          @click="
            showForm = false;
            error = '';
          "
        >
          Cancelar
        </button>
      </div>
    </form>
    <form class="season-filter" @submit.prevent="load(true)">
      <label for="season-status">Estado de temporada</label
      ><select id="season-status" v-model="filter" :disabled="loading">
        <option value="ALL">Todas</option>
        <option value="DRAFT">Borradores</option>
        <option value="ACTIVE">Activas</option>
        <option value="CLOSED">Cerradas</option></select
      ><button :disabled="loading">Filtrar temporadas</button>
    </form>
    <p v-if="loading">Cargando temporadas…</p>
    <p v-else-if="!items.length && !error" class="empty-state">
      Todavía no hay temporadas para este filtro.
    </p>
    <ul class="season-list">
      <li v-for="season in items" :key="season.id">
        <div>
          <h3>{{ season.name }}</h3>
          <p>
            {{ season.year }} · {{ displayDate(season.startDate) }} al
            {{ displayDate(season.endDate) }}
          </p>
          <span class="status-badge">{{ labels[season.status] }}</span>
        </div>
        <button
          v-if="isLeagueAdmin && season.status !== 'CLOSED'"
          type="button"
          class="secondary"
          :disabled="saving"
          @click="confirm = season"
        >
          {{
            season.status === 'DRAFT' ? 'Activar temporada' : 'Cerrar temporada'
          }}
        </button>
      </li>
    </ul>
    <nav v-if="total > 0" class="pagination" aria-label="Páginas de temporadas">
      <button
        type="button"
        class="secondary"
        :disabled="page === 1 || loading"
        @click="
          page--;
          load();
        "
      >
        Anterior</button
      ><span
        >Página {{ page }} de {{ Math.max(1, Math.ceil(total / 10)) }} ·
        {{ total }} temporadas</span
      ><button
        type="button"
        class="secondary"
        :disabled="page * 10 >= total || loading"
        @click="
          page++;
          load();
        "
      >
        Siguiente
      </button>
    </nav>
    <div v-if="confirm" class="confirmation">
      <p>
        {{
          confirm.status === 'DRAFT'
            ? `¿Activar ${confirm.name}?`
            : `¿Cerrar ${confirm.name}? La temporada permanecerá disponible en el historial.`
        }}
      </p>
      <div class="button-row">
        <button type="button" :disabled="saving" @click="transition">
          Confirmar
          {{ confirm.status === 'DRAFT' ? 'activación' : 'cierre' }}</button
        ><button
          type="button"
          class="secondary"
          :disabled="saving"
          @click="confirm = null"
        >
          Cancelar
        </button>
      </div>
    </div>
    <button
      v-if="error"
      type="button"
      class="secondary"
      :disabled="loading"
      @click="load()"
    >
      Actualizar temporadas
    </button>
  </section>
</template>
