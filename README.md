# LISFI Platform

Monorepo Vue/Hono con D1 y una primera base de autenticación y permisos en la API.
La pantalla incluye ingreso con correo/contraseña, desafío TOTP, restauración y
cierre de sesión, clubes asignados, invitaciones por enlace, recuperación de
contraseña y administración de representantes; no hay registro público ni
cuentas predeterminadas.

Incluye alta controlada del primer administrador y configuración visual de MFA
con QR local, clave manual y códigos de recuperación. El flujo completo se prueba
en navegador contra un Worker y D1 temporales; los casos de error de UI también
usan respuestas simuladas.

## Requisitos

- Node.js 22.14+ de la rama 22 (fijado en `.node-version` para CI); también compatible con Node 24.
- pnpm 11.25.0 (`packageManager` fija la versión).
- No se necesita cuenta de Cloudflare, token ni base remota. Health funciona sin entorno;
  las rutas de autenticación requieren un secreto local (ver más abajo).

Si necesitás instalar pnpm, con una instalación funcional de npm:

```sh
npm install --global pnpm@11.25.0
```

## Inicio local

Desde la raíz:

```sh
pnpm install
pnpm db:migrate:local
pnpm dev
```

- Frontend: <http://127.0.0.1:5173>
- API: <http://127.0.0.1:8787/api/health>
- Respuesta esperada: `{"status":"ok","service":"lisfi-api"}`.

Vite envía `/api/*` al Worker local. La pantalla comprueba el contrato con Zod,
muestra errores de conexión y permite reintentar. Detené los procesos con Ctrl+C.
También podés ejecutar `pnpm dev:web` y `pnpm dev:api` en terminales separadas.
Los puertos locales son 5173 y 8787. Las pruebas E2E usan 5174 y 8788 para no
interrumpir una sesión de desarrollo abierta.

## Estructura

```text
apps/
  web/src/             Vue; futuros módulos de UI por funcionalidad
  api/src/
    db/                Esquema y fábrica Drizzle para binding D1
    modules/auth/      Sesiones, MFA y lecturas protegidas por membresía
    index.ts           Entrada Hono; /api/health
    env.ts             Tipos de bindings del Worker
  api/migrations/      SQL y snapshots generados por Drizzle
packages/shared/src/   Contratos Zod y tipos públicos; sin acceso a DB ni secretos
tests/e2e/             Integración navegador → Vite → Worker
docs/                  Documentación Markdown; PDF y otros adjuntos excluidos de Git
.github/workflows/     Validación automática; sin despliegue
```

## Comandos

| Comando                                 | Resultado                                                                       |
| --------------------------------------- | ------------------------------------------------------------------------------- |
| `pnpm check`                            | Formato, ESLint, TypeScript, Vitest y builds                                    |
| `pnpm test` / `pnpm test:watch`         | Tests unitarios de contrato y API                                               |
| `pnpm exec playwright install chromium` | Instala el navegador de prueba una vez                                          |
| `pnpm test:e2e`                         | Arranca los servidores y prueba conexión/error/reintento en escritorio y 360 px |
| `pnpm format`                           | Formatea el código y la documentación nueva                                     |
| `pnpm db:generate`                      | Genera una migración desde el esquema Drizzle                                   |
| `pnpm db:migrate:local`                 | Aplica migraciones a D1 local, nunca remoto                                     |
| `pnpm build`                            | Genera `apps/web/dist` y empaqueta Worker en `apps/api/dist` sin desplegar      |

En Linux, Playwright puede necesitar `pnpm exec playwright install --with-deps chromium`.
CI instala estas dependencias automáticamente. `pnpm install --frozen-lockfile` reproduce
las versiones del lockfile; no lo edites manualmente.

## D1 y migraciones

`apps/api/wrangler.jsonc` contiene un identificador ficticio y el binding `DB`.
Wrangler emula D1 con persistencia en `apps/api/.wrangler/`, ignorada por Git.
La primera migración crea `seasons`; la segunda agrega el esquema oficial de
Better Auth (incluye MFA y rate limiting) y las tablas mínimas de clubes, membresías
y roles globales. No hay datos precargados. Auth usa timestamps en milisegundos,
generados por su CLI/Drizzle; el dominio usa ISO-8601. La API de temporadas permite
crear borradores y activar o cerrar temporadas con auditoría; no impone una única
temporada activa mientras no esté definido el contexto competitivo.

Para modificar el esquema: editar `apps/api/src/db/schema.ts`, ejecutar
`pnpm db:generate`, revisar el SQL generado y ejecutar `pnpm db:migrate:local`.
Versionar tanto el SQL como `migrations/meta`. No modificar migraciones ya aplicadas.
La restricción de temporada activa por competición queda pendiente de definición.
`/api/health` es liveness: no consulta D1 ni certifica disponibilidad de dependencias.

## Configuración y secretos

Para habilitar las rutas de auth localmente:

```sh
pnpm auth:setup:local
pnpm db:migrate:local
pnpm dev
```

El primer comando crea `apps/api/.dev.vars` con un secreto aleatorio y el origen
`http://127.0.0.1:5173`; no imprime el secreto ni sobrescribe un archivo existente.
Si ya existe, editarlo siguiendo `.dev.vars.example`. Reiniciar Wrangler después
de cambiarlo. Git ignora `.dev.vars`, `.env` y variantes. Usar siempre el origen
configurado (no alternar `localhost` y `127.0.0.1`). Sin una configuración válida,
las rutas protegidas devuelven 503 y health sigue disponible.
En entornos remotos se usarán secretos de Workers, nunca código ni variables `VITE_*`.
No cargar información personal real ni documentos de menores en desarrollo.

## Autenticación y alcance de esta entrega

- Better Auth 1.7.12 con adaptador oficial Drizzle sobre D1. Contraseñas y TOTP
  quedan a cargo de la biblioteca. El esquema se genera con
  `pnpm --filter @lisfi/api auth:generate`; luego revisar el diff, ejecutar
  `pnpm db:generate` y aplicar la migración local. No editar el esquema generado.
- `GET/POST /api/auth/*` expone la API de la biblioteca, con alta pública cerrada.
  Todo POST requiere `Origin` idéntico a `AUTH_BASE_URL`, incluso el login.
- `GET /api/me` devuelve identidad, rol global, necesidad de MFA y clubes propios.
- `GET /api/clubs/:id` devuelve el detalle autorizado de un club. Un representante
  ajeno recibe 404; sin sesión recibe 401. El módulo de clubes se describe abajo.
- Administradores requieren MFA verificado para leer clubes. Los representantes usan
  membresías vigentes; puede haber varios representantes por club y varios clubes por usuario.
- Las sesiones duran 8 horas, sin caché de cookies de sesión. Cada consulta vuelve
  a verificar estado del usuario, roles y membresías. Cerrar sesión o revocar acceso
  surte efecto en la próxima petición. Cambios de usuario a través de Better Auth
  invalidan sesiones anteriores, incluyendo las previas a habilitar MFA.
- Cookies HttpOnly/SameSite=Lax; Secure obligatorio fuera de loopback, junto con HTTPS.
  Rate limiting persiste en D1 y usa `CF-Connecting-IP`, proporcionado por Cloudflare.
  Debe complementarse con controles de plataforma antes de abrir producción.

El alta inicial usa un flujo separado, deshabilitado por defecto y protegido por
una clave temporal. Signup público continúa cerrado. La persona administradora
inicial puede invitar a otros administradores. Los administradores pueden invitar
representantes y generar enlaces de recuperación para compartir por WhatsApp. Estos
enlaces no verifican por sí solos el correo ni la identidad.

### Invitar a otro administrador

1. El administrador inicial inicia sesión y completa MFA. En **Invitar
   administrador**, ingresa el correo del destinatario y genera una clave.
2. Comparte la clave y el correo exacto por un canal privado. La clave se muestra
   una sola vez, vence en una hora y solo puede usarse una vez. No se envía correo
   automáticamente ni se guarda la clave sin cifrar en la base de datos.
3. La persona invitada abre **Aceptar invitación**, completa nombre, correo,
   contraseña propia y clave; después inicia sesión y configura MFA. Hasta completar
   MFA no puede acceder a funciones administrativas.

Solo el administrador creado en el bootstrap puede emitir invitaciones, y debe
conservar cuenta activa, rol y MFA verificado tanto al emitir como al aceptar. Esta
restricción provisional evita que cualquier administrador pueda conceder el rol;
la designación de otros responsables y la recuperación del acceso elevado siguen
pendientes de acordar con LISFI. La invitación crea una cuenta nueva: todavía no
permite promover una cuenta existente. No marca el correo como verificado.

La creación, credencial, rol, consumo de clave y auditoría se guardan en un único
batch D1. La auditoría identifica al emisor y el recurso sin guardar claves ni
correo. No hay revocación manual de invitaciones todavía: vencen en una hora y
dejan de funcionar si el emisor pierde su rol, su cuenta activa o su MFA verificado.

### Invitaciones, revocaciones y recuperación por WhatsApp

Un administrador con MFA genera desde un club activo un enlace para su presidente.
El presidente, una vez registrado, puede generar enlaces para los representantes
de ese club. Antes de compartirlos por WhatsApp debe verificar por un canal
independiente la identidad y el número de la persona. Debe comunicarle también el
correo exacto usado para crear la invitación. Cada enlace vence en una hora, es de
un solo uso y no verifica que la persona controle ese correo. Al aceptar una
invitación de representante se crea una cuenta y una solicitud de membresía;
dos administradores distintos deben
aprobarla antes de que exista acceso al club. Las cuentas existentes pueden ser
asignadas a otros clubes mediante solicitudes de cambio.

Las solicitudes se consultan en la sección de cambios de los administradores; aún
no se envían avisos automáticos. El permiso de presidente y la ficha institucional
de presidencia son registros separados: cuando cambia el presidente, LISFI debe
revocar la membresía de la cuenta anterior, actualizar la ficha institucional y
enviar una nueva invitación. El cambio de ficha por sí solo no revoca ese acceso.

Desde el detalle del club se puede revocar una membresía; la siguiente petición de
esa cuenta pierde acceso a ese club, manteniendo sus otras membresías. El
administrador inicial puede revocar a otros administradores desde su panel; no puede
revocarse a sí mismo. Las operaciones se auditan sin guardar enlaces ni contraseñas.

Para recuperar una contraseña, un administrador verifica primero la identidad y el
número de WhatsApp de la persona y genera un enlace desde su ficha. Solo el
administrador inicial puede generar enlaces para otras cuentas administrativas.
El enlace vence en una hora y se usa una sola vez; cambiar la contraseña cierra las
sesiones y conserva el MFA. Si se pierden el MFA y sus códigos de recuperación, o
el administrador inicial pierde su acceso, todavía no existe un procedimiento de
recuperación de emergencia: hay que acordarlo antes de un piloto. No compartir
estos enlaces en grupos ni registrar sus contenidos en sistemas de terceros.

### Gestión de clubes

Después de ingresar y completar MFA, el administrador accede al listado de clubes:
alta, detalle, edición, desactivación y reactivación. Los representantes solo consultan
clubes activos con membresía vigente. Cambios de rol, membresía y estado se verifican
en cada petición. `/api/me` tampoco devuelve clubes a administradores con MFA pendiente.

- `GET /api/clubs`: `page` (desde 1), `pageSize` (1–50, por defecto 10), `q`
  (hasta 100 caracteres), `status` (`ACTIVE`, `INACTIVE`, `ALL`) y `sort`
  (`name_asc`, `name_desc`, `newest`). Los totales están filtrados por permisos;
  pedir `ALL` nunca amplía el acceso de un representante. Búsqueda literal por nombre,
  nombre corto o slug; SQLite aplica su comparación de texto predeterminada.
- El alta se solicita mediante `POST /api/changes` con `kind: CLUB`, nombre
  (1–120 caracteres), nombre corto opcional (hasta 40) y slug único (3–80 letras
  ASCII minúsculas, números y guiones). Se crea después de dos aprobaciones válidas;
  `POST /api/clubs` directo devuelve 403.
- `PATCH /api/clubs/:id`: los campos a modificar y `version` de la última lectura.
  Rechaza versiones obsoletas con 409 para impedir sobrescrituras concurrentes.
  El estado puede ser `ACTIVE` o `INACTIVE`; no se eliminan registros históricos.

Las mutaciones exigen administrador con MFA y el mismo origen configurado. Club y
evento en `audit_logs` se escriben juntos en un batch D1. El evento conserva actor,
acción, fecha y valores anteriores/nuevos del club; no contraseñas ni secretos.
La migración `0003_fixed_overlord.sql` agrega auditoría, nombre corto, fecha de
actualización y versión sin borrar clubes existentes. La fecha de actualización
de un club previo se presenta como su fecha de creación hasta la primera edición.
La consulta administrativa de auditoría está disponible.

Las solicitudes para asignar un representante se reciben sin revelar si existe
una cuenta para el correo indicado. Al aplicar la segunda aprobación, se comprueba
que la cuenta esté activa y que su correo esté verificado o haya aceptado una
invitación de representante; si no, la solicitud sigue pendiente y la aprobación falla.
Los representantes del club no reciben el correo
ni la identidad de la cuenta propuesta en el listado de solicitudes. La nueva
auditoría de cambios aplicados guarda identificadores y tipo, no el contenido
personal completo; los eventos anteriores a esta modificación se conservan.

### Primer administrador y MFA local

1. Ejecutar `pnpm auth:setup:local` si todavía no existe `.dev.vars` y aplicar
   `pnpm db:migrate:local`.
2. Ejecutar `pnpm auth:bootstrap:local`. Genera una clave aleatoria de 256 bits en
   `apps/api/.dev.vars`, válida durante una hora, sin imprimirla. Conserva los demás
   valores; repetirlo reemplaza la clave temporal. Reiniciar la API para cargarla.
3. En `http://127.0.0.1:5173`, abrir **Alta del primer administrador**. Completar
   nombre, correo y contraseña propia (12–128 caracteres), y pegar únicamente el
   valor de `BOOTSTRAP_TOKEN` en **Clave temporal de alta**. No usar `AUTH_SECRET`.
   La posesión de esa clave permite crear el primer administrador: compartirla solo
   por un canal privado con el responsable de la liga.
4. Ingresar con la cuenta creada, confirmar la contraseña y escanear el QR con un
   autenticador. También se puede ingresar la clave manualmente. Guardar los códigos
   de recuperación y verificar un código TOTP para activar MFA. Hasta entonces, la
   API bloquea el acceso administrativo. Si se abandona el enrolamiento pendiente,
   se puede iniciar de nuevo; esto reemplaza la clave y los códigos anteriores.
5. Quitar `BOOTSTRAP_TOKEN` y `BOOTSTRAP_EXPIRES_AT` de `.dev.vars` y reiniciar la API
   después del alta. En siguientes ingresos, se puede usar TOTP o un código de
   recuperación de un solo uso. El frontend no persiste claves ni códigos en storage.

`POST /api/bootstrap` exige el origen configurado, clave válida y fecha de
caducidad, limita el cuerpo a 8 KiB y los intentos a 5 por minuto por IP en D1.
La identidad, credencial Better Auth, rol y registro `initial_admin_bootstrap`
se insertan en un único batch atómico. El registro singleton impide altas
simultáneas y nuevos bootstraps, incluso si luego se eliminan cuentas o roles.
Una asignación administrativa existente (también revocada) cierra el alta inicial.
No se promueven cuentas existentes ni se marca el correo como verificado.
No borrar el registro de bootstrap para recuperar acceso: ese proceso sigue pendiente.

La migración `0002_volatile_thanos.sql` agrega ese registro sin modificar los
esquemas generados por Better Auth. Se conserva el emisor LISFI y la verificación
de TOTP predeterminada de la biblioteca. La API exige tanto el flag MFA como un
autenticador verificado para autorizar administradores, también ante un fallo
parcial del flujo de enrolamiento. Los QR se generan en el navegador, sin servicios
externos. No hay cuentas ni contraseñas predeterminadas.

Las pruebas crean cuentas `example.invalid` y secretos aleatorios únicamente en
una base efímera. Se prueban login, logout, caducidad, suspensión, MFA de dos admins,
aislamiento y revocación de membresías/roles, orígenes, rate limiting y restricciones
SQL. Miniflare es el mismo emulador incluido por Wrangler, expuesto como dependencia
directa solo para las pruebas. Las pruebas de auth ejecutan Hono en Node sobre D1
emulado; Playwright comprueba el frontend contra el Worker real de desarrollo.

D1 no admite transacciones interactivas: el adaptador Drizzle las deshabilita.
El adaptador nativo usa otra representación de fechas; se mantiene Drizzle para
evitar esquemas incompatibles. El alta inicial y las mutaciones de clubes usan
lotes atómicos verificados con pruebas de rollback. Otros flujos de auth de varios
pasos todavía requieren evaluar su compensación antes de implementarlos.
No hay despliegue ni se declara esta base lista para usuarios reales.

Referencias: [Better Auth/Hono](https://better-auth.com/docs/integrations/hono),
[Drizzle](https://better-auth.com/docs/adapters/drizzle),
[MFA](https://better-auth.com/docs/plugins/2fa).

## CI y publicación futura

El remoto es GitHub: Actions valida instalación congelada, formato, lint, tipos,
tests, builds, migración D1 local y Playwright en cada push/PR. Solo tiene permiso
de lectura del repositorio y no utiliza secretos. No hay job ni script de despliegue.

Para una entrega futura, Pages recibirá `apps/web/dist` y Workers alojará la API.
El proxy Vite solo existe en desarrollo: antes de publicar habrá que configurar
el dominio/ruta `/api/*` del Worker o definir orígenes explícitos y cookies seguras.
El identificador D1 local debe reemplazarse mediante configuración del entorno de
destino; crear recursos, aplicar migraciones remotas y desplegar requiere confirmación.

Las especificaciones y notas de trabajo Markdown se versionan en `docs/`.
Los PDF y demás adjuntos se conservan únicamente en el equipo local.
