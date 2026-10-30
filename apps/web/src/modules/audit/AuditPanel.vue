<script setup lang="ts">
import { ref } from 'vue';
import { auditResponseSchema, type AuditEntry } from '@lisfi/shared';
const emit = defineEmits<{ expired: []; recheck: [] }>();
const open = ref(false);
const loading = ref(false);
const error = ref('');
const type = ref('ALL');
const from = ref('');
const to = ref('');
const page = ref(1);
const total = ref(0);
const entries = ref<AuditEntry[]>([]);
const actions: Record<string, string> = {
  CLUB_CREATED: 'Club creado',
  CLUB_UPDATED: 'Club actualizado',
  CLUB_DEACTIVATED: 'Club desactivado',
  CLUB_REACTIVATED: 'Club reactivado',
  CHANGE_REQUESTED: 'Solicitud presentada',
  CHANGE_APPROVED: 'Solicitud aprobada',
  CHANGE_REJECTED: 'Solicitud rechazada',
  CHANGE_APPLIED: 'Cambio aplicado',
  SEASON_CREATED: 'Temporada creada',
  SEASON_ACTIVATED: 'Temporada activada',
  SEASON_CLOSED: 'Temporada cerrada',
  ADMIN_INVITED: 'Invitación administrativa creada',
  ADMIN_GRANTED: 'Administrador incorporado',
};
const types: Record<string, string> = {
  CLUB: 'Club',
  SEASON: 'Temporada',
  CHANGE_REQUEST: 'Solicitud',
  ADMIN_INVITATION: 'Invitación administrativa',
  USER: 'Usuario',
};
const kinds: Record<string, string> = {
  CLUB: 'Alta de club',
  PRESIDENT: 'Presidencia',
  REPRESENTATIVE: 'Representante',
  TECHNICAL_DIRECTOR: 'Director técnico',
  PLAYER: 'Jugador',
};
const fields: Record<string, string> = {
  name: 'Nombre',
  shortName: 'Nombre corto',
  slug: 'Identificador',
  status: 'Estado',
};
const states: Record<string, string> = {
  DRAFT: 'Borrador',
  ACTIVE: 'Activo',
  CLOSED: 'Cerrada',
  INACTIVE: 'Inactivo',
};
function value(v: string | null) {
  return v === null || v === '' ? 'Sin valor' : states[v] || v;
}
let version = 0;
function date(value: string) {
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime())
    ? value
    : new Intl.DateTimeFormat('es-AR', {
        dateStyle: 'short',
        timeStyle: 'short',
        timeZone: 'UTC',
      }).format(parsed);
}
async function load(reset = false) {
  if (reset) page.value = 1;
  if (from.value && to.value && from.value > to.value) {
    error.value = 'La fecha inicial no puede ser posterior a la fecha final.';
    return;
  }
  const current = ++version;
  loading.value = true;
  error.value = '';
  entries.value = [];
  try {
    const params = new URLSearchParams({
      page: String(page.value),
      pageSize: '10',
      resourceType: type.value,
      from: from.value,
      to: to.value,
    });
    const response = await fetch(`/api/audit-logs?${params}`, {
      credentials: 'same-origin',
      cache: 'no-store',
      signal: AbortSignal.timeout(10000),
    });
    if (response.status === 401) {
      emit('expired');
      return;
    }
    if (response.status === 403) {
      emit('recheck');
      return;
    }
    if (!response.ok) throw new Error('fetch');
    const result = auditResponseSchema.parse(await response.json());
    if (current !== version) return;
    entries.value = result.items;
    total.value = result.total;
  } catch {
    if (current === version)
      error.value = 'No pudimos consultar la actividad. Intentá nuevamente.';
  } finally {
    if (current === version) loading.value = false;
  }
}
function toggle() {
  open.value = !open.value;
  if (open.value) void load(true);
  else {
    version++;
    loading.value = false;
    entries.value = [];
    error.value = '';
  }
}
</script>
<template>
  <section
    class="audit-panel"
    aria-labelledby="audit-title"
    :aria-busy="loading"
  >
    <div class="section-heading">
      <div>
        <p class="eyebrow">Administración de la liga</p>
        <h2 id="audit-title">Actividad registrada</h2>
      </div>
      <button
        type="button"
        class="secondary"
        :aria-expanded="open"
        @click="toggle"
      >
        {{ open ? 'Ocultar actividad' : 'Ver actividad' }}
      </button>
    </div>
    <template v-if="open">
      <p>
        Consultá quién realizó cada acción y cuándo. Las fechas y horas usan
        UTC; los nombres de recursos son actuales.
      </p>
      <form class="audit-filters" @submit.prevent="load(true)">
        <div>
          <label for="audit-type">Tipo</label
          ><select id="audit-type" v-model="type">
            <option value="ALL">Todos</option>
            <option value="CLUB">Clubes</option>
            <option value="CHANGE_REQUEST">Solicitudes</option>
            <option value="SEASON">Temporadas</option>
            <option value="ADMIN_INVITATION">
              Invitaciones administrativas
            </option>
            <option value="USER">Usuarios</option>
          </select>
        </div>
        <div>
          <label for="audit-from">Desde</label
          ><input id="audit-from" v-model="from" type="date" />
        </div>
        <div>
          <label for="audit-to">Hasta</label
          ><input id="audit-to" v-model="to" type="date" />
        </div>
        <button :disabled="loading">Buscar actividad</button>
      </form>
      <p v-if="error" role="alert">{{ error }}</p>
      <p v-if="loading">Cargando actividad…</p>
      <p v-else-if="!entries.length && !error" class="empty-state">
        No hay actividad para estos filtros.
      </p>
      <ol v-if="entries.length" class="audit-list">
        <li v-for="entry in entries" :key="entry.id">
          <div>
            <strong>{{ actions[entry.action] || entry.action }}</strong>
            <p>
              {{ types[entry.resourceType] || entry.resourceType
              }}<template v-if="entry.requestKind">
                · {{ kinds[entry.requestKind] || entry.requestKind }}</template
              ><template v-if="entry.resourceName">
                · {{ entry.resourceName }}</template
              >
            </p>
            <p>Por {{ entry.actorName }} · {{ date(entry.createdAt) }}</p>
            <ul v-if="entry.changes.length">
              <li v-for="change in entry.changes" :key="change.field">
                {{ fields[change.field] || change.field }}:
                {{ value(change.before) }} → {{ value(change.after) }}
              </li>
            </ul>
            <details>
              <summary>Referencia</summary>
              <code>{{ entry.resourceId }}</code>
            </details>
          </div>
        </li>
      </ol>
      <nav
        v-if="total > 0"
        class="pagination"
        aria-label="Páginas de actividad"
      >
        <button
          type="button"
          class="secondary"
          :disabled="loading || page === 1"
          @click="
            page--;
            load();
          "
        >
          Anterior</button
        ><span
          >Página {{ page }} de {{ Math.max(1, Math.ceil(total / 10)) }} ·
          {{ total }} registros</span
        ><button
          type="button"
          class="secondary"
          :disabled="loading || page * 10 >= total"
          @click="
            page++;
            load();
          "
        >
          Siguiente
        </button>
      </nav>
      <button
        v-if="error"
        type="button"
        class="secondary"
        :disabled="loading"
        @click="load()"
      >
        Reintentar actividad
      </button>
    </template>
  </section>
</template>
