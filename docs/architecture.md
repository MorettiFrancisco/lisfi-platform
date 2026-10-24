# Decisiones técnicas — iteración 1

Fecha de revisión: 22 de octubre de 2026.

## Alcance y fuentes internas

Se leyó `LISFI_Etapa1_Especificacion_Funcional_y_Modelo_Datos (19).md` (octubre,
versión 0.1) y `INFORME TÉCNICO.pdf` (marzo). El PDF describe el producto completo;
la especificación más reciente y el pedido de primera iteración delimitan esta entrega.
Los documentos originales se conservan sin cambios.

## ADR 001 — Monolito modular en un workspace

Tres paquetes privados: web, API y shared. Una API y una base multi-club. Sin
microservicios, colas, contenedores, orquestadores de builds ni bibliotecas de estado.
pnpm ejecuta scripts recursivos; Vite/Wrangler empaquetan shared desde su fuente TS.
Su build separado verifica emisión de JS/declaraciones, pero no es requisito de `dev`.
Shared expone contratos públicos, nunca tablas de base de datos ni lógica privilegiada.

Los próximos módulos vivirán en `apps/api/src/modules/<dominio>` (rutas, servicio,
consultas y tests juntos) y `apps/web/src/modules/<dominio>`. Crear esas carpetas cuando
haya código, sin esqueletos vacíos. Los permisos se aplicarán en servidor por sesión
y membresía vigente en cada operación; el selector de club del cliente no autoriza.

## ADR 002 — D1/Drizzle y migraciones locales

Drizzle utiliza el binding de D1, sin credenciales HTTP ni conexiones TCP.
Drizzle Kit genera SQL SQLite y Wrangler aplica las migraciones. Solo `seasons`
inicia el esquema, con estado y orden de fechas restringidos en SQL; los esquemas
de identidad se generarán desde auth en la siguiente iteración. No se impone una
única temporada activa global: falta definir contexto competitivo.

No asumir transacciones interactivas en D1. Para futuras mutaciones con auditoría,
diseñar lotes atómicos y restricciones SQL; verificar rollback en el runtime real.
La fábrica `createDb` recibe el binding por solicitud, facilitando pruebas e inyección.

## ADR 003 — Better Auth seleccionado, implementación siguiente

Better Auth 1.7.12 es la versión estable consultada. Tiene integración oficial Hono,
cliente Vue y soporte para D1. Se selecciona por sesiones gestionadas por una
biblioteca mantenida y compatibilidad con el stack. No se instala aún: la primera
iteración no tiene login ni rutas privadas.

La prueba de autenticación priorizará el soporte D1 nativo de Better Auth, que
documenta atomicidad mediante batch. Drizzle seguirá siendo el ORM de dominio y
el generador de migraciones. El adaptador Drizzle/SQLite es otra opción oficial,
pero no se asumirá que ofrece las mismas garantías transaccionales que el nativo.
La integración definitiva y el esquema generado requieren una prueba local con
registro controlado, sesiones, revocación y rollback antes de abrir acceso a usuarios.
No se añade un wrapper comunitario de Cloudflare.

Requisitos de la siguiente iteración: cuentas individuales por invitación, sin alta
pública; MFA administrativo; cookies HttpOnly/Secure/SameSite y CSRF/orígenes de
confianza; recuperación por canal verificado; límites de intentos persistentes;
revocación inmediata sin cachear permisos de membresía. Habilitar la compatibilidad
Node que requiera auth en ese momento. Secretos solo por entorno. Roles globales
separados de membresías de club; ninguna asignación de privilegios desde el cliente.

## Versiones verificadas

Se consultaron versiones, engines y peerDependencies en npm y documentación oficial.
Se fijan versiones directas y lockfile para evitar actualizaciones implícitas.

| Componente                 | Versión elegida            | Motivo                                                     |
| -------------------------- | -------------------------- | ---------------------------------------------------------- |
| Node                       | 22.14.0 en CI; 24 admitido | Requisitos comunes de Vite, Vitest, ESLint y Wrangler      |
| pnpm                       | 11.25.0                    | Disponible localmente, fijado en packageManager            |
| Vue / Vite / plugin-vue    | 3.5.44 / 8.3.5 / 6.0.10    | Rangos de pares compatibles                                |
| TypeScript                 | 6.0.3                      | TS 7.0.2 queda fuera del rango de typescript-eslint 8.72.0 |
| Hono / Zod                 | 4.13.13 / 4.6.7            | Versiones estables consultadas                             |
| Drizzle ORM / Kit          | 0.45.4 / 0.31.11           | Línea estable, soporte SQLite/D1                           |
| Wrangler / Workers types   | 4.152.0 / 5.20261019.1     | Versiones de runtime y tipos compatibles                   |
| Vitest / Playwright        | 5.0.5 / 1.64.1             | Unitarios y prueba real navegador→Worker                   |
| ESLint / typescript-eslint | 10.13.0 / 8.72.0           | Pares compatibles con TS 6.0                               |
| Prettier / vue-tsc         | 3.9.10 / 3.3.13            | Formato y comprobación de SFC                              |

pnpm 11 configura `saveExact`, `engineStrict` y `allowBuilds` en el YAML del workspace,
no en `.npmrc`. Solo esbuild y workerd ejecutan scripts de instalación, necesarios
para sus binarios. Se conservan las excepciones exactas de antigüedad introducidas
por pnpm para Wrangler y su Miniflare: revisar estas dependencias al actualizar.
Drizzle Kit incorpora dos dependencias transitivas obsoletas de esbuild-kit; se
documenta el aviso y se evita sustituirlas manualmente por versiones incompatibles.

## Pendientes y riesgos

| Decisión/riesgo                                | Próxima acción                                                                |
| ---------------------------------------------- | ----------------------------------------------------------------------------- |
| Quién asigna administradores y recupera acceso | Confirmar MANAGE_ADMINS/LEAGUE_OWNER y responsables                           |
| Temporadas simultáneas                         | Definir competición/contexto antes de imponer unicidad                        |
| Invitaciones y recuperación                    | Elegir proveedor/canal y presupuesto; aún no se añade servicio                |
| Dominio Pages/Worker                           | Elegir ruta del mismo origen o CORS explícito antes del login remoto          |
| Costos y abuso de auth                         | Medir CPU de credenciales, limitar intentos y revisar cuotas antes del piloto |
| Acceso cruzado entre clubes                    | Tests negativos por endpoint y consulta; permisos efectivos tras revocación   |
| Auditoría y consistencia                       | Mutación y evento en lote atómico; metadata mínima y sin secretos             |
| Backups/restore                                | Definir retención y ensayar restauración antes del piloto                     |
| Datos de menores                               | Resolver requisitos administrativos/legales y retención antes de Etapa 2      |
| Nombre operativo de clubes                     | Acordar normalización/unicidad y padrón oficial                               |

## Iteraciones siguientes

1. Prueba vertical de auth y roles: dos administradores, sesiones y MFA, migración
   generada por la biblioteca y permisos por membresía con revocación efectiva.
2. Clubes/delegados e invitaciones: validación, aislamiento, paginación y auditoría.
3. Temporadas: transiciones controladas y contexto competitivo confirmado.
4. Preparación del piloto: recuperación, backups/restore, cuotas y despliegue aprobado.

## Referencias oficiales

### Actualización: alta inicial y enrolamiento MFA visual (iteración 2B)

Se agrega `POST /api/bootstrap`, separado de Better Auth y deshabilitado sin una
capacidad aleatoria temporal configurada por el operador. Requiere mismo origen,
limita intentos persistentemente y nunca habilita signup público. El hash de la
contraseña usa `better-auth/crypto`; el esquema de credenciales es el existente.
Se crea una identidad nueva, sin afirmar verificación de correo ni iniciar sesión.

El batch D1 incluye el registro singleton de alta, usuario, credencial y rol.
Una restricción CHECK impide usarlo cuando ya hay asignaciones administrativas;
la PK impide dos ganadores concurrentes. Un fallo en cualquiera de las escrituras
revierte todo el lote. El registro conserva ID de usuario y fecha como auditoría
mínima, sin FK en cascada: eliminar la cuenta no debe reabrir el alta inicial.

La UI conduce desde el alta al login y al enrolamiento TOTP. QR y códigos quedan
en memoria del componente; el QR se renderiza localmente. La verificación activa
MFA mediante Better Auth y luego se consulta `/api/me` con la cookie renovada.
Los permisos administrativos comprueban flag MFA y registro TOTP verificado,
evitando conceder acceso ante una actualización parcial. Se ofrece ingreso con
código de recuperación. No se introduce administración de otros administradores,
restablecimiento de MFA, invitaciones ni recuperación por correo.

Playwright usa un Worker con configuración, secretos aleatorios y D1 en un
directorio temporal por ejecución. Aplica todas las migraciones y comprueba alta,
enrolamiento, login TOTP y recuperación sin tocar `.dev.vars` ni D1 del desarrollador.
Los fixtures y capturas son exclusivamente sintéticos. La prueba de bootstrap corre
una sola vez y cambia a viewport móvil durante el flujo, por su naturaleza singleton.

Referencias: [batch transaccional D1](https://developers.cloudflare.com/d1/worker-api/d1-database/)
y [enrolamiento y recuperación Better Auth](https://better-auth.com/docs/plugins/2fa).

### Actualización: base de autenticación (iteración 2A)

Se implementó la base de API con Better Auth 1.7.12 y el adaptador oficial Drizzle,
generando el esquema mediante el CLI `auth` 1.7.12. Esta decisión reemplaza la
preferencia inicial por el adaptador D1 nativo: sus fechas ISO no coinciden con los
timestamps en milisegundos del esquema Drizzle generado. Se usa una única representación
y `transaction: false` porque D1 no admite transacciones interactivas.

Incluye `/api/me`, lectura mínima de club autorizado, MFA obligatorio para lectura
administrativa, membresías revocables y límite de intentos persistente en D1. No
incluye UI de login, bootstrap de administradores, invitaciones, recuperación por
correo ni auditoría de mutaciones. La API cierra signup público; no hay cuentas
predeterminadas. Los tests usan identidades ficticias en D1 efímero.

Verificación local: 11 tests Vitest (8 de integración/configuración), 4 Playwright,
lint, tipos, builds y migraciones correctos. Se prueba aislamiento multiclub,
revocación inmediata, suspensión, expiración, logout, MFA de dos administradores,
orígenes y rate limit. Se verificó el rollback de un batch fallido; eso no implica
atomicidad automática en los flujos de varios pasos de Better Auth. Las próximas
altas deben resolver esa garantía explícitamente.

Por indicación del usuario, se versionan únicamente los archivos Markdown de esta
carpeta; el PDF y demás adjuntos permanecen locales y excluidos de Git.
Las instrucciones reproducibles y decisiones públicas están también en el README.

- [Vite: requisitos de Node](https://vite.dev/guide/)
- [Drizzle y D1](https://orm.drizzle.team/docs/sqlite/connect-cloudflare-d1)
- [Better Auth y Hono](https://better-auth.com/docs/integrations/hono)
- [Better Auth: adaptador Drizzle](https://better-auth.com/docs/adapters/drizzle)
- [Better Auth: D1 nativo y batch](https://github.com/better-auth/better-auth/blob/main/docs/content/blogs/1-5.mdx)
- [pnpm 11: cambios de configuración](https://pnpm.io/blog/releases/11.0)
