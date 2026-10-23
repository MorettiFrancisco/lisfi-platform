# LISFI Platform

Primera iteración: monorepo Vue/Hono, contrato de health compartido y base local D1.
No incluye todavía autenticación, permisos ni administración de clubes/delegados.

## Requisitos

- Node.js 22.14+ de la rama 22 (fijado en `.node-version` para CI); también compatible con Node 24.
- pnpm 11.25.0 (`packageManager` fija la versión).
- No se necesita cuenta de Cloudflare, token, base remota ni archivo de entorno para desarrollar.

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
Los puertos locales son 5173 y 8787; mantenelos libres para las pruebas E2E.

## Estructura

```text
apps/
  web/src/             Vue; futuros módulos de UI por funcionalidad
  api/src/
    db/                Esquema y fábrica Drizzle para binding D1
    index.ts           Entrada Hono; /api/health
    env.ts             Tipos de bindings del Worker
  api/migrations/      SQL y snapshots generados por Drizzle
packages/shared/src/   Contratos Zod y tipos públicos; sin acceso a DB ni secretos
tests/e2e/             Integración navegador → Vite → Worker
docs/                  Especificación, decisiones y próximos pasos
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
El esquema inicial solo contiene `seasons`: sirve para verificar el circuito de
migraciones sin anticipar las tablas que debe generar la solución de autenticación.
No hay API de temporadas ni datos precargados. Las fechas del modelo son ISO-8601;
la validación estricta de entradas se incorporará junto con sus endpoints.

Para modificar el esquema: editar `apps/api/src/db/schema.ts`, ejecutar
`pnpm db:generate`, revisar el SQL generado y ejecutar `pnpm db:migrate:local`.
Versionar tanto el SQL como `migrations/meta`. No modificar migraciones ya aplicadas.
La restricción de temporada activa por competición queda pendiente de definición.
`/api/health` es liveness: no consulta D1 ni certifica disponibilidad de dependencias.

## Configuración y secretos

No hay configuración sensible en esta entrega. El archivo
`apps/api/.dev.vars.example` documenta dónde irán los secretos futuros. Copiarlo a
`.dev.vars` solo cuando sean necesarios; Git ignora `.dev.vars`, `.env` y variantes.
En entornos remotos se usarán secretos de Workers, nunca código ni variables `VITE_*`.
No cargar información personal real ni documentos de menores en desarrollo.

## CI y publicación futura

El remoto es GitHub: Actions valida instalación congelada, formato, lint, tipos,
tests, builds, migración D1 local y Playwright en cada push/PR. Solo tiene permiso
de lectura del repositorio y no utiliza secretos. No hay job ni script de despliegue.

Para una entrega futura, Pages recibirá `apps/web/dist` y Workers alojará la API.
El proxy Vite solo existe en desarrollo: antes de publicar habrá que configurar
el dominio/ruta `/api/*` del Worker o definir orígenes explícitos y cookies seguras.
El identificador D1 local debe reemplazarse mediante configuración del entorno de
destino; crear recursos, aplicar migraciones remotas y desplegar requiere confirmación.

Las especificaciones y notas de trabajo se conservan localmente en `docs/`,
excluida de Git. El README contiene las instrucciones públicas del proyecto.
