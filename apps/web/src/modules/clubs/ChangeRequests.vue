<script setup lang="ts">
import { onMounted, ref, watch } from 'vue';
const props = defineProps<{ clubId?: string; isLeagueAdmin: boolean }>();
const emit = defineEmits<{ changed: [] }>();
type Kind = 'PRESIDENT' | 'REPRESENTATIVE' | 'TECHNICAL_DIRECTOR' | 'PLAYER';
type Item = {
  id: string;
  kind: string;
  clubId: string | null;
  clubName: string | null;
  requesterName: string;
  status: string;
  approvals: number;
  approvedByMe: number;
  payload: Record<string, string | null>;
};
const items = ref<Item[]>([]);
const kind = ref<Kind>('PRESIDENT');
const name = ref('');
const email = ref('');
const firstName = ref('');
const lastName = ref('');
const error = ref('');
const notice = ref('');
const busy = ref(false);
const showForm = ref(false);
const labels: Record<string, string> = {
  CLUB: 'Alta de club',
  PRESIDENT: 'Presidente',
  REPRESENTATIVE: 'Representante',
  TECHNICAL_DIRECTOR: 'Director técnico',
  PLAYER: 'Jugador',
};
async function api(path: string, body?: unknown) {
  const response = await fetch(path, {
    method: body === undefined ? 'GET' : 'POST',
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
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || 'Error');
  return data;
}
async function load() {
  try {
    items.value = (await api('/api/changes')).items;
  } catch {
    error.value = 'No pudimos cargar las solicitudes. Volvé a intentar.';
  }
}
async function submit() {
  if (!props.clubId || busy.value) return;
  busy.value = true;
  error.value = '';
  notice.value = '';
  const common = { kind: kind.value, clubId: props.clubId };
  const body =
    kind.value === 'PLAYER'
      ? { ...common, firstName: firstName.value, lastName: lastName.value }
      : kind.value === 'REPRESENTATIVE'
        ? { ...common, email: email.value }
        : { ...common, name: name.value };
  try {
    await api('/api/changes', body);
    name.value = '';
    email.value = '';
    firstName.value = '';
    lastName.value = '';
    showForm.value = false;
    notice.value =
      'Solicitud enviada. El cambio se aplicará después de dos aprobaciones de la liga.';
    await load();
  } catch (cause) {
    error.value =
      cause instanceof Error && cause.message === 'Verified account required'
        ? 'La persona debe tener una cuenta activa con correo verificado.'
        : 'No pudimos enviar la solicitud. Revisá los datos y volvé a intentar.';
  } finally {
    busy.value = false;
  }
}
async function approve(id: string) {
  if (busy.value) return;
  busy.value = true;
  error.value = '';
  notice.value = '';
  try {
    const result = await api(
      `/api/changes/${encodeURIComponent(id)}/approve`,
      {},
    );
    notice.value =
      result.status === 'APPLIED'
        ? 'Segunda aprobación registrada y cambio aplicado.'
        : 'Aprobación registrada. Falta otra persona administradora.';
    await load();
    emit('changed');
  } catch {
    error.value =
      'No se pudo aprobar. La solicitud puede haber cambiado o los datos ya no estar disponibles; actualizá antes de reintentar.';
    await load();
  } finally {
    busy.value = false;
  }
}
async function reject(id: string) {
  if (busy.value || !window.confirm('¿Rechazar esta solicitud?')) return;
  busy.value = true;
  error.value = '';
  notice.value = '';
  try {
    await api(`/api/changes/${encodeURIComponent(id)}/reject`, {});
    notice.value = 'Solicitud rechazada.';
    await load();
  } catch {
    error.value =
      'No se pudo rechazar la solicitud. Actualizá y volvé a intentar.';
    await load();
  } finally {
    busy.value = false;
  }
}
function description(item: Item) {
  return item.kind === 'PLAYER'
    ? `${item.payload.firstName} ${item.payload.lastName}`
    : String(item.payload.name || '');
}
onMounted(load);
watch(
  () => props.clubId,
  () => {
    showForm.value = false;
    void load();
  },
);
</script>
<template>
  <section class="changes-panel" aria-labelledby="changes-title">
    <div class="section-heading">
      <div>
        <p class="eyebrow">Control de la liga</p>
        <h3 id="changes-title">Solicitudes y aprobaciones</h3>
      </div>
      <button
        v-if="clubId"
        type="button"
        :disabled="busy"
        @click="showForm = !showForm"
      >
        {{ showForm ? 'Cerrar formulario' : 'Solicitar asignación' }}
      </button>
    </div>
    <p>
      Cada solicitud requiere la aprobación de dos administradores distintos de
      la liga.
    </p>
    <p v-if="error" role="alert">{{ error }}</p>
    <p v-if="notice" class="success-message">{{ notice }}</p>
    <form
      v-if="showForm && clubId"
      class="club-editor"
      @submit.prevent="submit"
    >
      <label for="change-kind">¿Qué querés solicitar?</label>
      <select id="change-kind" v-model="kind" :disabled="busy">
        <option value="PRESIDENT">Presidente</option>
        <option value="REPRESENTATIVE">Representante</option>
        <option value="TECHNICAL_DIRECTOR">Director técnico</option>
        <option value="PLAYER">Jugador</option>
      </select>
      <template v-if="kind === 'PLAYER'"
        ><label for="player-first">Nombre</label
        ><input
          id="player-first"
          v-model="firstName"
          required
          maxlength="120" /><label for="player-last">Apellido</label
        ><input id="player-last" v-model="lastName" required maxlength="120"
      /></template>
      <template v-else-if="kind === 'REPRESENTATIVE'"
        ><label for="rep-email">Correo de la cuenta del representante</label
        ><input
          id="rep-email"
          v-model="email"
          type="email"
          required
          maxlength="254"
        />
        <p class="hint">
          Debe ser una cuenta existente, activa y con correo verificado.
        </p></template
      >
      <template v-else
        ><label for="person-name">Nombre y apellido</label
        ><input id="person-name" v-model="name" required maxlength="120"
      /></template>
      <p v-if="kind === 'PRESIDENT'" class="hint">
        Si ya hay un presidente, se solicitará su reemplazo.
      </p>
      <button :disabled="busy">
        {{ busy ? 'Enviando…' : 'Enviar solicitud' }}
      </button>
    </form>
    <ul class="request-list">
      <li
        v-for="item in items.filter((x) =>
          clubId ? x.clubId === clubId : true,
        )"
        :key="item.id"
      >
        <div>
          <strong>{{ labels[item.kind] }}: {{ description(item) }}</strong>
          <p v-if="item.clubName">{{ item.clubName }}</p>
          <p v-if="item.kind === 'CLUB'">
            Identificador: {{ item.payload.slug
            }}<span v-if="item.payload.shortName">
              · Nombre corto: {{ item.payload.shortName }}</span
            >
          </p>
          <p v-if="item.kind === 'REPRESENTATIVE'">
            Correo: {{ item.payload.email }}
          </p>
          <p
            v-if="
              item.kind === 'PRESIDENT' && item.payload.previousPresidentName
            "
          >
            Reemplaza a {{ item.payload.previousPresidentName }}
          </p>
          <p>
            Solicitó {{ item.requesterName }} ·
            {{
              item.status === 'APPLIED'
                ? 'Aplicada'
                : item.status === 'REJECTED'
                  ? 'Rechazada'
                  : `Pendiente · ${item.approvals}/2 aprobaciones`
            }}
          </p>
        </div>
        <div
          v-if="isLeagueAdmin && item.status === 'PENDING'"
          class="button-row"
        >
          <button
            v-if="isLeagueAdmin && item.status === 'PENDING'"
            type="button"
            :disabled="busy || !!item.approvedByMe"
            @click="approve(item.id)"
          >
            {{ item.approvedByMe ? 'Ya aprobaste' : 'Aprobar' }}</button
          ><button
            type="button"
            class="secondary"
            :disabled="busy"
            @click="reject(item.id)"
          >
            Rechazar
          </button>
        </div>
      </li>
    </ul>
    <p
      v-if="!items.filter((x) => (clubId ? x.clubId === clubId : true)).length"
    >
      No hay solicitudes para mostrar.
    </p>
    <button type="button" class="secondary" :disabled="busy" @click="load">
      Actualizar solicitudes
    </button>
  </section>
</template>
