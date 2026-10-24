# Verificación de la primera iteración

## Actualización del 24 de octubre de 2026: alta inicial y MFA visual

- 19 tests Vitest de contrato/API: incluye expiración/origen/token, rate limit,
  concurrencia, rechazo de cuentas existentes, cierre duradero y rollback de las
  cuatro escrituras del bootstrap. También verifica MFA incompleto y no reutilización
  de códigos de recuperación.
- Playwright: el flujo real contra Worker/D1 temporal crea el primer administrador,
  configura MFA, inicia sesión con TOTP y con código de recuperación. Comprueba
  escritorio y 360 px en ese mismo flujo. Los escenarios adicionales de UI usan mocks.
- La migración 0002 se aplicó localmente. Los secretos de trabajo no se imprimieron
  ni versionaron; el alta real queda a cargo del usuario con sus propios datos.
- Los problemas de formato preexistentes del repositorio se mantienen fuera del
  alcance; se comprueba Prettier sobre los archivos modificados.

El informe que sigue corresponde a la primera iteración y conserva su alcance histórico.

Ejecutada localmente el 22 de octubre de 2026, en Windows.
El shell ofrece Node 22.14.0; el pnpm del entorno de trabajo usa su runtime Node
24.22.1. Ambos están admitidos por los engines declarados. El workflow remoto
está configurado para Node 22.14.0 y todavía no fue ejecutado en GitHub.

| Comprobación                     | Resultado                                                 |
| -------------------------------- | --------------------------------------------------------- |
| `pnpm install`                   | Correcto, 4 paquetes de workspace                         |
| `pnpm install --frozen-lockfile` | Correcto, sin cambios de resolución                       |
| `pnpm check`                     | Formato, lint, tipos, tests y builds correctos            |
| Vitest                           | 3 tests en 2 archivos                                     |
| Build web                        | Vite genera el sitio estático                             |
| Build API                        | Wrangler dry-run genera el Worker sin publicar            |
| `pnpm db:generate`               | Migración y snapshots generados desde Drizzle             |
| `pnpm db:migrate:local`          | Migración aplicada; segunda ejecución sin pendientes      |
| Consulta D1 local                | Tabla `seasons` presente en sqlite_master                 |
| `pnpm test:e2e`                  | 4 tests: conexión y error/reintento, escritorio y 360 px  |
| Exclusiones Git                  | `.dev.vars`, `.env`, `.env.local` y `.wrangler` ignorados |

Playwright inicia Vite y Wrangler local, espera `/api/health` y verifica tanto
la UI como el JSON real a través del proxy. Los tests de error simulan HTTP 503
en el navegador y luego reintentan contra la API real.

No se probaron aún autenticación, autorización, datos de dominio, backups ni
publicación; pertenecen a las próximas iteraciones. El health check no comprueba
disponibilidad de D1. No se usaron datos personales ni credenciales de Cloudflare.

Incidencias resueltas: el sandbox impidió acceso a npm y una consulta de usuario
del sistema de Drizzle; se ejecutaron las herramientas con permisos aprobados.
Se ajustó la configuración de pnpm 11 y se delegó a vue-tsc la comprobación de
identificadores TS en los componentes Vue. npm del perfil local apunta a una
instalación incompleta; no se modificó, ya que pnpm funciona independientemente.
