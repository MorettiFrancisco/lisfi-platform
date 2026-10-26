# Entregable: gestión de clubes — 25 de octubre de 2026

Implementado sobre la base de autenticación y MFA existente. Incluye alta, edición,
consulta de detalle, desactivación y reactivación; búsqueda, filtros, orden y
paginación; solicitudes de asignación para representantes y administradores; y auditoría atómica por operación.

## Estructura de cada club

El código distingue al administrador de liga (`LEAGUE_ADMIN`) del representante
de club (`CLUB_REPRESENTATIVE`). La migración 0004 renombra las membresías existentes
conservando sus vínculos, fechas y revocaciones.

La ficha incluye presidente, representantes, directores técnicos y jugadores.
La base permite un único presidente vigente, varios representantes y directores
técnicos y una nómina de jugadores con identidad independiente de su vínculo al club.
Los clubes sin personas cargadas muestran estados pendientes; todavía no se exige
completar la nómina al crear un club. Los cargos institucionales no conceden permisos
de acceso por sí solos.

## Solicitudes y aprobaciones

El alta de un club y las asignaciones o cambio de presidente, representante,
director técnico y jugador requieren dos aprobaciones de administradores de liga
distintos, activos y con MFA verificado. La solicitud no cuenta como aprobación.
Una persona administradora puede aprobar una vez; otra debe aprobar para aplicar
el cambio. Un administrador también puede rechazar la solicitud. El alta del club
la solicita la liga; sus representantes vigentes también pueden solicitar personas
para su club activo. El sistema registra cada solicitud, aprobación, rechazo y
aplicación. Si la presidencia cambió desde la solicitud, la aplicación falla y la
solicitud debe rechazarse y rehacerse. El alta directa de clubes está bloqueada.

La asignación de un representante requiere una cuenta activa existente con correo
verificado. Los jugadores se crean con nombre y apellido; aún no se admite elegir
una identidad de jugador existente. No se han implementado las inscripciones deportivas
ni los consentimientos.

## Verificación

- 29 tests de contrato/API aprobados: doble aprobación, conflictos, migración de membresías, estructura e invariantes,
  aislamiento de listados y totales, revocación,
  MFA obligatorio, origen confiable, validación, slug duplicado, escritura concurrente,
  rollback de club/auditoría y transiciones de estado.
- El flujo Playwright real crea una cuenta temporal, activa MFA y verifica que una
  única aprobación no crea un club.
- 19 pruebas de navegador aprobadas (y una variante omitida intencionalmente para
  no repetir el bootstrap singleton). Los escenarios con respuestas simuladas comprueban también vista de
  representante, pérdida de acceso y recuperación de conflictos sin perder el borrador.
- Tipos, lint, builds y formato de los archivos modificados verificados. Persisten
  problemas de formato históricos fuera de esta entrega.
- Migraciones 0003 a 0005 aplicadas a D1 local. No se ejecutó ningún despliegue remoto.

## Auditoría solicitada

Revisión de solo lectura realizada por un subagente GPT-6 Luna con esfuerzo alto.
Sus salidas fueron correcciones concretas; el agente principal las aplicó y probó:

1. **MFA pendiente:** `/api/me` devolvía nombres de clubes a administradores sin MFA.
   Ahora devuelve `clubs: []` sin consultar las membresías hasta verificar MFA.
   La prueba asigna una membresía real al administrador pendiente y verifica el vacío.
   También comprueba que el detalle está bloqueado y que, después de verificar TOTP,
   `/api/me` vuelve a mostrar esa membresía y el detalle queda disponible.
2. **Origen con barra final:** el middleware nuevo comparaba `Origin` con la URL de
   configuración sin normalizar. Ahora usa `new URL(AUTH_BASE_URL).origin`, al igual
   que auth. La prueba configura una URL con `/` final y verifica el alta válida.
   Se verificó además la edición con esa configuración: acepta el mismo origen,
   rechaza orígenes ajenos o ausentes y no modifica el club ni su auditoría al rechazar.

La exigencia de MFA se centralizó en el middleware de todas las rutas de clubes.
La segunda revisión del frontend no reportó otros bugs reproducibles. La auditoría
no sustituye las pruebas: el subagente no ejecutó tests ni modificó archivos.

Revisión de cierre del 25 de octubre: ambos hallazgos comprobados contra el código
actual y sus regresiones aprobadas. No quedan correcciones pendientes de esta auditoría.

## Límites de esta entrega

Todavía no incluye el alta de un segundo administrador ni el registro o invitación de
representantes: para completar el circuito deben existir dos administradores con MFA
y las cuentas verificadas de los representantes. Tampoco incluye bajas de personas.
No completa por sí sola toda la Etapa 1. Los clubes de las capturas son
ficticios y pertenecen al entorno temporal de pruebas; no se precargan en la base local.
