# LISFI Platform

Monorepo Vue/Hono con D1 y una primera base de autenticación y permisos en la API.
La pantalla actual muestra el estado del servicio. Login visual, invitaciones,
recuperación por correo y administración completa de clubes/delegados son las
siguientes entregas; no hay registro público ni cuentas predeterminadas.

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
generados por su CLI/Drizzle; el dominio usa ISO-8601. No hay API de temporadas.

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
- `GET /api/clubs/:id` es una lectura mínima para comprobar permisos. Un delegado
  ajeno recibe 404; sin sesión recibe 401. No es todavía un CRUD de clubes.
- Administradores requieren MFA verificado para leer clubes. Los delegados usan
  membresías vigentes; puede haber varios delegados por club y varios clubes por usuario.
- Las sesiones duran 8 horas, sin caché de cookies de sesión. Cada consulta vuelve
  a verificar estado del usuario, roles y membresías. Cerrar sesión o revocar acceso
  surte efecto en la próxima petición. Cambios de usuario a través de Better Auth
  invalidan sesiones anteriores, incluyendo las previas a habilitar MFA.
- Cookies HttpOnly/SameSite=Lax; Secure obligatorio fuera de loopback, junto con HTTPS.
  Rate limiting persiste en D1 y usa `CF-Connecting-IP`, proporcionado por Cloudflare.
  Debe complementarse con controles de plataforma antes de abrir producción.

No existe aún un flujo de alta del primer administrador: no habilitar signup para
resolverlo. La próxima entrega implementará bootstrap controlado e invitaciones,
una vez definido quién administra privilegios y qué canal verificado se utilizará.
Recuperación por correo y auditoría administrativa también están pendientes.

Las pruebas crean cuentas `example.invalid` y secretos aleatorios únicamente en
una base efímera. Se prueban login, logout, caducidad, suspensión, MFA de dos admins,
aislamiento y revocación de membresías/roles, orígenes, rate limiting y restricciones
SQL. Miniflare es el mismo emulador incluido por Wrangler, expuesto como dependencia
directa solo para las pruebas. Las pruebas de auth ejecutan Hono en Node sobre D1
emulado; Playwright comprueba el frontend contra el Worker real de desarrollo.

D1 no admite transacciones interactivas: el adaptador Drizzle las deshabilita.
El adaptador nativo usa otra representación de fechas; se mantiene Drizzle para
evitar esquemas incompatibles. Antes de añadir mutaciones administrativas se
validarán lotes atómicos con auditoría y compensación de flujos de auth de varios pasos.
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
