<script setup lang="ts">
import { onMounted, onUnmounted, ref, watch } from 'vue';
import ChangeRequests from './ChangeRequests.vue';
import {
  clubSchema,
  clubDetailSchema,
  clubsResponseSchema,
  clubInputSchema,
  type Club,
  type ClubDetail,
} from '@lisfi/shared';

const props = defineProps<{ isLeagueAdmin: boolean }>();
const emit = defineEmits<{
  expired: [];
  recheck: [];
  busy: [value: boolean];
}>();
const items = ref<Club[]>([]);
const total = ref(0);
const page = ref(1);
const query = ref('');
const status = ref('ACTIVE');
const sort = ref('name_asc');
const loading = ref(false);
const saving = ref(false);
const error = ref('');
const notice = ref('');
const selected = ref<ClubDetail | null>(null);
const mode = ref<'new' | 'view' | 'edit' | null>(null);
const name = ref('');
const shortName = ref('');
const slug = ref('');
const confirmStatus = ref(false);
let requestVersion = 0;

class RequestError extends Error {
  constructor(
    public status: number,
    public reason: string,
  ) {
    super(reason);
  }
}
async function request(path: string, method = 'GET', body?: unknown) {
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
  if (!response.ok) {
    const data = await response.json().catch(() => ({}));
    throw new RequestError(response.status, data.error ?? '');
  }
  return response.json();
}
function report(cause: unknown) {
  if (
    cause instanceof RequestError &&
    (cause.status === 401 || cause.status === 403)
  ) {
    items.value = [];
    selected.value = null;
    mode.value = null;
    if (cause.status === 401) emit('expired');
    else emit('recheck');
  } else {
    error.value =
      cause instanceof RequestError && cause.status === 409
        ? cause.reason === 'Slug already exists'
          ? 'Ese identificador ya pertenece a otro club. Elegí uno distinto.'
          : 'Otra persona modificó este club. Recargá el club antes de volver a guardar.'
        : cause instanceof RequestError && cause.status === 404
          ? 'El club ya no está disponible. Actualizá el listado.'
          : 'No pudimos completar la operación. Revisá tu conexión y volvé a consultar antes de repetir un cambio.';
  }
}
async function load(reset = false) {
  if (reset) page.value = 1;
  const version = ++requestVersion;
  loading.value = true;
  error.value = '';
  items.value = [];
  try {
    const params = new URLSearchParams({
      page: String(page.value),
      pageSize: '10',
      q: query.value,
      status: status.value,
      sort: sort.value,
    });
    const result = clubsResponseSchema.parse(
      await request(`/api/clubs?${params}`),
    );
    if (version !== requestVersion) return;
    items.value = result.items;
    total.value = result.total;
    if (page.value > 1 && !items.value.length) {
      page.value = Math.max(1, Math.ceil(total.value / 10));
      await load();
    }
  } catch (cause) {
    if (version === requestVersion) report(cause);
  } finally {
    if (version === requestVersion) loading.value = false;
  }
}
function newClub() {
  selected.value = null;
  name.value = '';
  shortName.value = '';
  slug.value = '';
  error.value = '';
  notice.value = '';
  mode.value = 'new';
}
async function openClub(id: string) {
  loading.value = true;
  error.value = '';
  notice.value = '';
  selected.value = null;
  mode.value = null;
  confirmStatus.value = false;
  try {
    selected.value = clubDetailSchema.parse(
      await request(`/api/clubs/${encodeURIComponent(id)}`),
    );
    mode.value = 'view';
  } catch (cause) {
    report(cause);
  } finally {
    loading.value = false;
  }
}
function edit() {
  if (!selected.value) return;
  name.value = selected.value.name;
  shortName.value = selected.value.shortName ?? '';
  slug.value = selected.value.slug;
  mode.value = 'edit';
  error.value = '';
  notice.value = '';
  confirmStatus.value = false;
}
async function save(changeStatus = false) {
  if (saving.value) return;
  const parsed = clubInputSchema.safeParse({
    name: name.value,
    shortName: shortName.value || null,
    slug: slug.value,
  });
  if (!changeStatus && !parsed.success) {
    error.value =
      'Revisá el nombre y el identificador: usá entre 3 y 80 letras minúsculas, números o guiones.';
    return;
  }
  saving.value = true;
  error.value = '';
  notice.value = '';
  const current = selected.value;
  try {
    if (!current) {
      await request('/api/changes', 'POST', {
        kind: 'CLUB',
        details: parsed.data,
      });
      mode.value = null;
      await load();
      notice.value =
        'Solicitud de alta enviada. El club se creará después de dos aprobaciones de la liga.';
      return;
    }
    const body =
      changeStatus && current
        ? {
            status: current.status === 'ACTIVE' ? 'INACTIVE' : 'ACTIVE',
            version: current.version,
          }
        : { ...parsed.data, ...(current ? { version: current.version } : {}) };
    const result = clubSchema.parse(
      await request(
        current ? `/api/clubs/${encodeURIComponent(current.id)}` : '/api/clubs',
        current ? 'PATCH' : 'POST',
        body,
      ),
    );
    selected.value = {
      ...current,
      ...result,
    };
    mode.value = 'view';
    confirmStatus.value = false;
    await load();
    notice.value = changeStatus
      ? result.status === 'ACTIVE'
        ? 'Club reactivado.'
        : 'Club desactivado. Sus representantes ya no pueden acceder.'
      : 'Club guardado correctamente.';
  } catch (cause) {
    report(cause);
  } finally {
    saving.value = false;
  }
}
watch(
  () => props.isLeagueAdmin,
  () => {
    mode.value = null;
    selected.value = null;
    status.value = 'ACTIVE';
    void load(true);
  },
);
watch(saving, (value) => emit('busy', value));
onUnmounted(() => emit('busy', false));
onMounted(() => load());
</script>

<template>
  <div
    class="clubs-panel"
    aria-labelledby="clubs-title"
    :aria-busy="loading || saving"
  >
    <div class="section-heading">
      <div>
        <p class="eyebrow">
          {{ isLeagueAdmin ? 'Administración' : 'Mis clubes' }}
        </p>
        <h2 id="clubs-title">Clubes</h2>
      </div>
      <button
        v-if="isLeagueAdmin && !mode"
        :disabled="loading || saving"
        @click="newClub"
      >
        Nuevo club
      </button>
    </div>
    <p v-if="error" role="alert">{{ error }}</p>
    <p v-if="notice" class="success-message">{{ notice }}</p>
    <p v-if="loading">Cargando clubes…</p>
    <template v-if="!mode">
      <ChangeRequests :is-league-admin="isLeagueAdmin" @changed="load()" />
      <form class="club-filters" @submit.prevent="load(true)">
        <div>
          <label for="club-search">Buscar club</label
          ><input
            id="club-search"
            v-model="query"
            type="search"
            maxlength="100"
            placeholder="Nombre o identificador"
            :disabled="loading"
          />
        </div>
        <div v-if="isLeagueAdmin">
          <label for="club-status">Estado</label
          ><select id="club-status" v-model="status" :disabled="loading">
            <option value="ACTIVE">Activos</option>
            <option value="INACTIVE">Inactivos</option>
            <option value="ALL">Todos</option>
          </select>
        </div>
        <div>
          <label for="club-sort">Orden</label
          ><select id="club-sort" v-model="sort" :disabled="loading">
            <option value="name_asc">Nombre A–Z</option>
            <option value="name_desc">Nombre Z–A</option>
            <option value="newest">Más recientes</option>
          </select>
        </div>
        <button :disabled="loading">Buscar</button>
      </form>
      <p v-if="!loading && !error && !items.length" class="empty-state">
        {{
          isLeagueAdmin
            ? 'No hay clubes para estos filtros. Podés crear uno o cambiar la búsqueda.'
            : 'No tenés clubes disponibles para esta búsqueda.'
        }}
      </p>
      <ul v-if="items.length" class="club-list">
        <li v-for="club in items" :key="club.id">
          <div>
            <h3>{{ club.name }}</h3>
            <p>{{ club.shortName || club.slug }}</p>
            <span
              class="status-badge"
              :class="{ inactive: club.status === 'INACTIVE' }"
              >{{ club.status === 'ACTIVE' ? 'Activo' : 'Inactivo' }}</span
            >
          </div>
          <button
            class="secondary"
            :disabled="loading"
            :aria-label="`Ver club ${club.name}`"
            @click="openClub(club.id)"
          >
            Ver club
          </button>
        </li>
      </ul>
      <nav
        v-if="!error && total > 0"
        class="pagination"
        aria-label="Páginas de clubes"
      >
        <button
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
          {{ total }} clubes</span
        ><button
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
      <button v-if="error" :disabled="loading" @click="load()">
        Reintentar listado
      </button>
    </template>
    <form
      v-if="mode === 'new' || mode === 'edit'"
      class="club-editor"
      @submit.prevent="save()"
    >
      <h3>{{ mode === 'new' ? 'Nuevo club' : 'Editar club' }}</h3>
      <label for="club-name">Nombre del club</label
      ><input
        id="club-name"
        v-model="name"
        maxlength="120"
        required
        :disabled="saving"
      />
      <label for="club-short-name">Nombre corto (opcional)</label
      ><input
        id="club-short-name"
        v-model="shortName"
        maxlength="40"
        :disabled="saving"
      />
      <label for="club-slug">Identificador del club</label
      ><input
        id="club-slug"
        v-model="slug"
        minlength="3"
        maxlength="80"
        pattern="[a-z0-9]+(-[a-z0-9]+)*"
        placeholder="club-atletico"
        required
        :disabled="saving"
      />
      <p class="hint">
        Debe ser único. Usá letras minúsculas, números y guiones.
      </p>
      <div class="button-row">
        <button :disabled="saving">
          {{
            saving
              ? 'Guardando…'
              : mode === 'new'
                ? 'Solicitar alta'
                : 'Guardar club'
          }}</button
        ><button
          type="button"
          class="secondary"
          :disabled="saving"
          @click="
            mode = selected ? 'view' : null;
            error = '';
          "
        >
          Cancelar</button
        ><button
          v-if="selected && error"
          type="button"
          class="secondary"
          :disabled="saving"
          @click="openClub(selected.id)"
        >
          Recargar club
        </button>
      </div>
    </form>
    <div v-if="mode === 'view' && selected" class="club-detail">
      <h3>{{ selected.name }}</h3>
      <p v-if="selected.shortName">{{ selected.shortName }}</p>
      <dl>
        <dt>Identificador</dt>
        <dd>{{ selected.slug }}</dd>
        <dt>Estado</dt>
        <dd>{{ selected.status === 'ACTIVE' ? 'Activo' : 'Inactivo' }}</dd>
      </dl>
      <div class="club-structure" aria-label="Estructura del club">
        <section aria-labelledby="president-title">
          <h4 id="president-title">Presidente</h4>
          <p>{{ selected.president?.name ?? 'Pendiente de designación' }}</p>
        </section>
        <section aria-labelledby="representatives-title">
          <h4 id="representatives-title">Representantes</h4>
          <ul v-if="selected.representatives.length">
            <li v-for="person in selected.representatives" :key="person.id">
              {{ person.name }}
            </li>
          </ul>
          <p v-else>Sin representantes asignados</p>
        </section>
        <section aria-labelledby="directors-title">
          <h4 id="directors-title">Directores técnicos</h4>
          <ul v-if="selected.technicalDirectors.length">
            <li v-for="person in selected.technicalDirectors" :key="person.id">
              {{ person.name }}
            </li>
          </ul>
          <p v-else>Sin directores técnicos cargados</p>
        </section>
        <section aria-labelledby="players-title">
          <h4 id="players-title">Jugadores</h4>
          <ul v-if="selected.players.length">
            <li v-for="person in selected.players" :key="person.id">
              {{ person.name }}
            </li>
          </ul>
          <p v-else>Sin jugadores cargados</p>
        </section>
      </div>
      <ChangeRequests
        v-if="selected.status === 'ACTIVE'"
        :club-id="selected.id"
        :is-league-admin="isLeagueAdmin"
        @changed="openClub(selected.id)"
      />
      <div v-if="isLeagueAdmin" class="button-row">
        <button :disabled="saving || loading" @click="edit">Editar club</button
        ><button
          class="secondary"
          :disabled="saving || loading"
          @click="confirmStatus = true"
        >
          {{
            selected.status === 'ACTIVE' ? 'Desactivar club' : 'Reactivar club'
          }}
        </button>
      </div>
      <div v-if="confirmStatus" class="confirmation">
        <p>
          {{
            selected.status === 'ACTIVE'
              ? 'Al desactivar este club, sus representantes perderán acceso. Se conservarán los datos y el historial.'
              : 'Al reactivar este club, sus membresías vigentes volverán a tener acceso.'
          }}
        </p>
        <div class="button-row">
          <button :disabled="saving" @click="save(true)">
            {{
              selected.status === 'ACTIVE'
                ? 'Confirmar desactivación'
                : 'Confirmar reactivación'
            }}</button
          ><button
            class="secondary"
            :disabled="saving"
            @click="confirmStatus = false"
          >
            Cancelar cambio de estado
          </button>
        </div>
      </div>
      <button
        v-if="error"
        class="secondary"
        :disabled="saving || loading"
        @click="openClub(selected.id)"
      >
        Recargar club
      </button>
      <button
        class="secondary back-link"
        :disabled="saving || loading"
        @click="
          mode = null;
          selected = null;
          notice = '';
          error = '';
          load();
        "
      >
        Volver a clubes
      </button>
    </div>
  </div>
</template>
