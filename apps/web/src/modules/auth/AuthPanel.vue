<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { meResponseSchema, type MeResponse } from '@lisfi/shared';
import BootstrapPanel from './BootstrapPanel.vue';
import MfaSetup from './MfaSetup.vue';
import ClubsPanel from '../clubs/ClubsPanel.vue';
import SeasonsPanel from '../seasons/SeasonsPanel.vue';
import AuditPanel from '../audit/AuditPanel.vue';
import AdminInvitationPanel from './AdminInvitationPanel.vue';
import AcceptInvitationPanel from './AcceptInvitationPanel.vue';
import RecoveryPanel from './RecoveryPanel.vue';
import AdministratorsPanel from './AdministratorsPanel.vue';

const identity = ref<MeResponse | null>(null);
const stage = ref<
  | 'loading'
  | 'login'
  | 'mfa'
  | 'session'
  | 'unavailable'
  | 'bootstrap'
  | 'invitation'
  | 'representative-invitation'
  | 'recover'
>('loading');
const invitationToken = ref('');
const invitationExisting = ref(false);
const email = ref('');
const password = ref('');
const code = ref('');
const busy = ref(false);
const error = ref('');
const notice = ref('');
const recovery = ref(false);
const mfaBusy = ref(false);
const clubsBusy = ref(false);
const seasonsBusy = ref(false);

function administratorCreated(accountEmail: string) {
  email.value = accountEmail;
  backToLogin();
  notice.value =
    'Cuenta creada. Ingresá con tu contraseña para configurar MFA.';
}
function representativeCreated(accountEmail: string) {
  email.value = accountEmail;
  invitationToken.value = '';
  backToLogin();
  notice.value =
    'Cuenta creada. El acceso al club requiere dos aprobaciones de la liga.';
}
function passwordRecovered() {
  invitationToken.value = '';
  backToLogin();
  notice.value =
    'Contraseña cambiada. Ingresá nuevamente con tus credenciales.';
}

async function useExistingInvitation() {
  invitationExisting.value = true;
  busy.value = true;
  error.value = '';
  try {
    if (await loadSession()) stage.value = 'representative-invitation';
    else notice.value = 'Ingresá con la cuenta invitada para continuar.';
  } catch {
    stage.value = 'unavailable';
    error.value = 'No pudimos consultar tu sesión. Intentá nuevamente.';
  } finally {
    busy.value = false;
  }
}

async function existingInvitationAccepted() {
  invitationToken.value = '';
  invitationExisting.value = false;
  await restore();
  notice.value =
    'Solicitud enviada. El acceso al club requiere dos aprobaciones de la liga.';
}

async function switchInvitationAccount() {
  if (busy.value) return;
  busy.value = true;
  error.value = '';
  try {
    const response = await fetch('/api/auth/sign-out', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: '{}',
      signal: AbortSignal.timeout(10000),
    });
    if (!response.ok) throw new Error('sign out failed');
    identity.value = null;
    stage.value = 'login';
    notice.value = 'Ingresá con la cuenta invitada para continuar.';
  } catch {
    error.value = 'No pudimos cerrar la sesión. Volvé a intentar.';
  } finally {
    busy.value = false;
  }
}

function sessionExpired() {
  identity.value = null;
  backToLogin();
  error.value = 'Tu sesión venció. Volvé a ingresar para continuar.';
}

async function loadSession() {
  const response = await fetch('/api/me', {
    credentials: 'same-origin',
    cache: 'no-store',
    signal: AbortSignal.timeout(10000),
  });
  if (response.status === 401) {
    identity.value = null;
    stage.value = 'login';
    return false;
  }
  if (!response.ok)
    throw new Error('No pudimos consultar tu sesión. Intentá nuevamente.');
  identity.value = meResponseSchema.parse(await response.json());
  stage.value = 'session';
  return true;
}

async function restore() {
  busy.value = true;
  error.value = '';
  try {
    await loadSession();
  } catch {
    stage.value = 'unavailable';
    error.value =
      'El acceso no está disponible en este momento. Intentá nuevamente.';
  } finally {
    busy.value = false;
  }
}

async function submit() {
  if (busy.value) return;
  busy.value = true;
  error.value = '';
  notice.value = '';
  const action = stage.value;
  const endpoint =
    action === 'mfa'
      ? recovery.value
        ? 'two-factor/verify-backup-code'
        : 'two-factor/verify-totp'
      : action === 'session'
        ? 'sign-out'
        : 'sign-in/email';
  const body =
    action === 'mfa'
      ? { code: code.value.trim() }
      : action === 'session'
        ? {}
        : {
            email: email.value.trim(),
            password: password.value,
            rememberMe: false,
          };
  try {
    const response = await fetch(`/api/auth/${endpoint}`, {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(10000),
    });
    if (!response.ok) {
      if (response.status === 429)
        throw new Error(
          'Demasiados intentos. Esperá un momento antes de volver a intentar.',
        );
      if (response.status >= 500)
        throw new Error(
          'El acceso no está disponible en este momento. Intentá nuevamente.',
        );
      throw new Error(
        action === 'mfa'
          ? 'No pudimos verificar el código. Revisalo e intentá nuevamente.'
          : action === 'session'
            ? 'No pudimos cerrar la sesión. Intentá nuevamente.'
            : 'No pudimos iniciar sesión. Revisá tu correo y contraseña.',
      );
    }
    if (action === 'session') {
      identity.value = null;
      email.value = '';
      stage.value = 'login';
    } else {
      const data = await response.json();
      if (action === 'login' && data.twoFactorRedirect === true) {
        recovery.value = false;
        stage.value = 'mfa';
      } else {
        // A successful credential response alone is not proof of an active session.
        stage.value = 'unavailable';
        if (!(await loadSession()))
          error.value = 'La sesión no está activa. Volvé a ingresar.';
        else if (invitationExisting.value)
          stage.value = 'representative-invitation';
      }
    }
  } catch (cause) {
    error.value =
      cause instanceof Error && cause.name === 'Error'
        ? cause.message
        : 'No pudimos conectar. Comprobá tu conexión e intentá nuevamente.';
  } finally {
    password.value = '';
    code.value = '';
    busy.value = false;
  }
}

function backToLogin() {
  stage.value = 'login';
  invitationToken.value = '';
  invitationExisting.value = false;
  code.value = '';
  error.value = '';
  notice.value = '';
  recovery.value = false;
}

onMounted(() => {
  const match =
    /^#(admin-invitation|representative-invitation|recover)=([a-f0-9]{64})$/.exec(
      window.location.hash,
    );
  if (match) {
    invitationToken.value = match[2]!;
    stage.value =
      match[1] === 'recover'
        ? 'recover'
        : match[1] === 'admin-invitation'
          ? 'invitation'
          : 'representative-invitation';
    window.history.replaceState(
      null,
      '',
      window.location.pathname + window.location.search,
    );
  } else void restore();
});
</script>

<template>
  <section aria-labelledby="access-title" :aria-busy="busy">
    <h2 id="access-title">
      {{
        stage === 'recover'
          ? 'Recuperar acceso'
          : stage === 'invitation' || stage === 'representative-invitation'
            ? 'Aceptar invitación'
            : stage === 'bootstrap'
              ? 'Alta del primer administrador'
              : stage === 'session'
                ? 'Tu sesión'
                : stage === 'mfa'
                  ? 'Verificá tu identidad'
                  : 'Ingresá a tu cuenta'
      }}
    </h2>
    <p v-if="stage === 'loading'">Comprobando tu sesión…</p>
    <p v-if="error" role="alert">{{ error }}</p>
    <p v-if="notice">{{ notice }}</p>
    <BootstrapPanel
      v-if="stage === 'bootstrap'"
      @created="administratorCreated"
      @cancel="backToLogin"
    />
    <AcceptInvitationPanel
      v-if="stage === 'invitation'"
      :initial-token="invitationToken"
      @created="administratorCreated"
      @cancel="backToLogin"
    />
    <RecoveryPanel
      v-if="stage === 'recover'"
      :token="invitationToken"
      @complete="passwordRecovered"
      @cancel="backToLogin"
    />
    <AcceptInvitationPanel
      v-if="stage === 'representative-invitation'"
      kind="representative"
      :initial-token="invitationToken"
      :existing-session="invitationExisting && !!identity"
      :account-name="identity?.user.name ?? ''"
      @created="representativeCreated"
      @existing="useExistingInvitation"
      @accepted-existing="existingInvitationAccepted"
      @switch-account="switchInvitationAccount"
      @cancel="backToLogin"
    />
    <form v-if="stage === 'login'" @submit.prevent="submit">
      <label for="email">Correo electrónico</label>
      <input
        id="email"
        v-model="email"
        name="email"
        type="email"
        autocomplete="username"
        required
        :disabled="busy"
      />
      <label for="password">Contraseña</label>
      <input
        id="password"
        v-model="password"
        name="password"
        type="password"
        autocomplete="current-password"
        required
        :disabled="busy"
      />
      <button :disabled="busy">{{ busy ? 'Ingresando…' : 'Ingresar' }}</button>
      <p class="hint">
        El acceso es por invitación. Si necesitás una cuenta o recuperar tu
        acceso, contactá a la administración de la liga.
      </p>
      <button
        type="button"
        class="secondary"
        :disabled="busy"
        @click="
          stage = 'bootstrap';
          error = '';
          notice = '';
        "
      >
        Alta del primer administrador
      </button>
      <button
        type="button"
        class="secondary"
        :disabled="busy"
        @click="
          stage = 'invitation';
          error = '';
          notice = '';
        "
      >
        Aceptar invitación
      </button>
    </form>
    <form v-if="stage === 'mfa'" @submit.prevent="submit">
      <p v-if="!recovery">
        Ingresá el código de seis dígitos de tu aplicación de autenticación.
      </p>
      <p v-else>
        Ingresá uno de los códigos que guardaste al activar MFA. Cada código se
        puede usar una sola vez.
      </p>
      <label for="code">{{
        recovery ? 'Código de recuperación' : 'Código de verificación'
      }}</label>
      <input
        id="code"
        v-model="code"
        name="code"
        :inputmode="recovery ? 'text' : 'numeric'"
        :autocomplete="recovery ? 'off' : 'one-time-code'"
        :pattern="recovery ? undefined : '[0-9]{6}'"
        :maxlength="recovery ? 32 : 6"
        required
        :disabled="busy"
      />
      <button :disabled="busy">
        {{ busy ? 'Verificando…' : 'Verificar código' }}
      </button>
      <button
        type="button"
        class="secondary"
        :disabled="busy"
        @click="
          recovery = !recovery;
          code = '';
          error = '';
        "
      >
        {{
          recovery ? 'Usar mi autenticador' : 'Usar un código de recuperación'
        }}
      </button>
      <button
        type="button"
        class="secondary"
        :disabled="busy"
        @click="backToLogin"
      >
        Volver al ingreso
      </button>
    </form>
    <div v-if="stage === 'session' && identity">
      <p>
        Hola, <strong>{{ identity.user.name }}</strong
        >.
      </p>
      <p v-if="identity.roles.includes('LEAGUE_ADMIN')">
        Administración de la liga
      </p>
      <p v-if="identity.mfaRequired" role="alert">
        Tu cuenta requiere configurar la autenticación de dos pasos antes de
        acceder a funciones administrativas.
      </p>
      <MfaSetup
        v-if="identity.mfaRequired"
        @complete="restore"
        @expired="sessionExpired"
        @busy="mfaBusy = $event"
      />
      <p v-else-if="identity.roles.includes('LEAGUE_ADMIN')">
        Autenticación de dos pasos activada.
      </p>
      <AdminInvitationPanel
        v-if="!identity.mfaRequired && identity.canManageAdmins"
      />
      <AdministratorsPanel
        v-if="!identity.mfaRequired && identity.canManageAdmins"
        :current-user-id="identity.user.id"
      />
      <button
        :disabled="busy || mfaBusy || clubsBusy || seasonsBusy"
        @click="submit"
      >
        {{ busy ? 'Cerrando…' : 'Cerrar sesión' }}
      </button>
      <ClubsPanel
        v-if="!identity.mfaRequired"
        :key="identity.user.id"
        :is-league-admin="identity.roles.includes('LEAGUE_ADMIN')"
        :president-club-ids="identity.presidentClubIds"
        @expired="sessionExpired"
        @recheck="restore"
        @busy="clubsBusy = $event"
      />
      <SeasonsPanel
        v-if="!identity.mfaRequired"
        :key="identity.user.id"
        :is-league-admin="identity.roles.includes('LEAGUE_ADMIN')"
        @expired="sessionExpired"
        @recheck="restore"
        @busy="seasonsBusy = $event"
      />
      <AuditPanel
        v-if="!identity.mfaRequired && identity.roles.includes('LEAGUE_ADMIN')"
        @expired="sessionExpired"
        @recheck="restore"
      />
    </div>
    <button v-if="stage === 'unavailable'" :disabled="busy" @click="restore">
      Reintentar acceso
    </button>
  </section>
</template>
