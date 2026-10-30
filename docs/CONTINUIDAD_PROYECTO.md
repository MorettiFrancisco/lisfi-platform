# Continuidad de LISFI Platform

Estado actualizado el 29 de octubre de 2026, después de `c91667d`. El proyecto
está en desarrollo local: la Etapa 1
todavía no está cerrada ni se autorizó un despliegue a producción.

## Qué se hizo

- Monorepo pnpm con Vue 3, TypeScript y Vite; API Hono en Cloudflare Workers;
  D1, Drizzle y validaciones Zod compartidas. Hay configuración de GitHub Actions,
  scripts de desarrollo, migraciones, pruebas y builds, y `/api/health`.
- Referencia OpenAPI en `/api/openapi.json` y Swagger UI local en `/docs/api` del
  frontend. Los contratos principales se generan desde Zod; la referencia se
  mantiene de forma incremental y no enumera todos los endpoints de Better Auth.
- Autenticación con Better Auth, bootstrap restringido para el administrador
  inicial, sesiones y MFA para administradores. El administrador inicial puede
  invitar y revocar a otros administradores; todos los administradores deben
  completar MFA antes de ejercer sus funciones.
- Clubes con edición, estado activo/inactivo, control de acceso por membresía,
  solicitudes de cambios y aprobación por dos administradores distintos. Hay
  temporadas con transiciones de estado y consulta de auditoría.
- Circuito acordado con LISFI: un administrador invita al presidente de un club;
  el presidente genera un enlace para cada representante de ese club; cuando la
  persona se registra se crea una solicitud y dos administradores deben aprobarla
  para habilitar su acceso. El presidente solo puede generar invitaciones para
  clubes en los que tiene autoridad vigente.
- Los presidentes y representantes invitados pueden aceptar con una cuenta ya
  existente; para representantes se mantiene la doble aprobación. Cuando un
  presidente ya tenía membresía en el club, se reutiliza esa membresía y se revoca
  al dejar la presidencia. Las membresías en otros clubes se conservan.
- Enlaces para compartir manualmente por WhatsApp: de un solo uso y con duración
  de una hora. La aplicación no envía mensajes ni verifica automáticamente la
  identidad, el teléfono o la propiedad del correo. La persona que comparte el
  enlace debe verificar la identidad y el número por un canal independiente.
- Revocación de membresías y recuperación de contraseñas mediante enlaces
  temporales. Recuperar contraseña cierra sesiones anteriores y conserva el MFA;
  solo el administrador inicial puede emitir enlaces para otros administradores.
  Las operaciones importantes generan auditoría sin guardar contraseñas ni enlaces.

## Verificación y estado local

- En la última ejecución completa `pnpm check` pasó: formato, ESLint, TypeScript,
  48 pruebas Vitest y builds. El build de Wrangler usó `--dry-run`, sin desplegar.
- Playwright ejecutó las pruebas existentes en escritorio y móvil: 19 pasaron y
  una prueba de bootstrap se omitió en móvil por configuración. La nueva prueba
  de la pantalla de invitación del presidente pasó en ambos tamaños por separado.
  La prueba de pantalla nueva usa respuestas simuladas; el circuito de permisos,
  invitaciones y doble aprobación también se comprobó en integración con D1 emulada.
- Swagger UI se probó en escritorio y móvil ejecutando `/api/health` sin conexiones
  externas. Una prueba de navegador con Worker y D1 temporales verificó `/api/me`
  desde Swagger con una sesión administrativa y MFA reales.
- Una prueba de navegador con Worker y D1 temporales completó el alta y MFA de dos
  administradores, la invitación de un presidente y de dos representantes
  independientes, con dos aprobaciones por representante. Verificó que no había
  acceso antes de la segunda aprobación.
  El caso de un representante en varios clubes también se verifica en integración;
  aún falta probar en navegador varios clubes en un mismo flujo.
- Las migraciones hasta `0014` se aplicaron a D1 **local**; no se aplicaron en una
  base remota. No hay datos personales reales de prueba ni secretos versionados.
- Para retomar: instalar Node y pnpm según [README](../README.md), ejecutar
  `pnpm install`, `pnpm db:migrate:local` y `pnpm dev`. La configuración y el
  bootstrap locales están explicados en ese README. En Git Bash de Windows, si
  `pnpm` no aparece en el PATH, incorporar la carpeta de npm del usuario.

## Qué quedó pendiente y riesgos

1. **Presidencia y acceso:** el cambio aprobado revoca la autoridad y membresía
   anterior del club, invalida invitaciones de presidencia pendientes y conserva
   membresías en otros clubes. La identidad del nuevo presidente sigue dependiendo
   de la verificación manual de LISFI; las solicitudes pendientes del presidente
   anterior necesitan una política explícita. Algunas solicitudes de cambio de
   presidente creadas antes de la migración 0013 deberán recrearse si ya había
   una autoridad activa, para verificar la situación actual antes de aprobarlas.
2. **Avisos:** las solicitudes aparecen en la sección administrativa de cambios,
   pero no se envían notificaciones. Definir con LISFI cómo se enteran los dos
   administradores sin agregar un proveedor innecesario.
3. **Recuperación de emergencia:** no hay procedimiento implementado para pérdida
   de acceso o MFA del administrador inicial, ni para recuperar MFA perdido de
   otras cuentas. Definir responsables y controles antes de un piloto; no borrar
   el registro de bootstrap ni modificar la base manualmente para eludirlo.
4. **Cuentas existentes:** el representante puede aceptar el enlace con una
   sesión de la cuenta invitada. La incorporación al nuevo club requiere dos
   aprobaciones y conserva las demás membresías. Los presidentes también pueden
   aceptar con una cuenta existente; si ya tenían membresía en ese club se reutiliza
   y se revoca al dejar la presidencia. Falta aceptación integral con LISFI.
5. **Privacidad y operación:** acordar verificación de identidad y teléfono,
   eventual verificación del correo, retención de auditoría, backups cifrados y
   una restauración ensayada. Las pruebas actuales no sustituyen una aceptación
   integral ni una revisión operativa antes de usar datos reales.
6. **Reglas funcionales:** confirmar si los aprobadores pueden ser solicitantes,
   qué ocurre si se revoca al solicitante o a un aprobador de una solicitud
   pendiente, y el contexto de temporadas simultáneas. La nómina de jugadores
   existente requiere revisión de alcance y privacidad; los fichajes, documentos
   de identidad y autorizaciones parentales corresponden a etapas posteriores.

## Orden propuesto de entregables

1. **Cierre del circuito de presidencia:** definir qué hacer con solicitudes
   pendientes del presidente anterior y agregar las pruebas correspondientes.
   Mantener iteraciones pequeñas y verificables.
2. **Aceptación del flujo de clubes:** ampliar el recorrido de navegador con datos
   ficticios para un representante en varios clubes y acceso denegado a uno ajeno.
   Acordar con LISFI el mecanismo de avisos y el manejo de cuentas existentes.
3. **Continuidad y seguridad:** diseñar y probar recuperación de emergencia y MFA,
   backup y restauración, límites de abuso, política de auditoría y procedimiento
   de verificación por WhatsApp.
4. **Cierre de Etapa 1 y preparación de piloto:** resolver las decisiones de
   temporadas y alcance, revisar accesibilidad y aceptación en escritorio y móvil,
   separar entornos y costos, y presentar el resultado para aprobación. Cualquier
   creación de recursos remotos o despliegue requiere confirmación del usuario.

Mantener los archivos Markdown de `docs/` versionados. El PDF adjunto permanece
local y excluido de Git, según la instrucción del usuario. No agregar tecnologías
sin justificar su necesidad ni implementar módulos completos de fichajes, torneos
o estadísticas como parte de estos pendientes.
