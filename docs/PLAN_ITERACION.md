# Estado y próximas iteraciones de LISFI

Revisión del 29 de octubre de 2026 sobre `e588248`, antes de las correcciones
derivadas de la auditoría de esta sesión. El objetivo sigue siendo completar la
Etapa 1 en entregas pequeñas; no se realizó ningún despliegue.

## Lo que ya existe

- Workspace, Vue, Hono, D1, Drizzle y migraciones, con CI configurado.
- Alta inicial de un administrador mediante una capacidad temporal, login,
  sesiones y MFA; el alta pública está cerrada.
- Clubes con consulta, edición, desactivación y acceso restringido por membresía.
  La creación requiere una solicitud y dos aprobaciones de administradores distintos.
- Solicitudes de cambios institucionales con aprobación, rechazo y auditoría;
  temporadas con transiciones y lectura administrativa de eventos.
- Pruebas de integración con D1 emulado y pruebas de navegador. La disponibilidad
  de características no implica que el circuito completo de alta esté operativo.

## Estado de invitaciones y acceso

Se incorporaron invitaciones de administradores, presidentes y representantes, revocación de
membresías y de administradores por el responsable inicial, y recuperación de
contraseñas mediante enlaces temporales para compartir por WhatsApp. La identidad
y el número deben verificarse fuera de la aplicación; el correo no se verifica con
este canal. La liga invita al presidente, que invita a los representantes de su
club. Las membresías de representantes conservan la doble aprobación.

## Próximas entregas propuestas

1. Definir y ensayar la recuperación de emergencia del administrador inicial y la
   pérdida de MFA, con responsables designados y controles contra escalación.
2. Validar con LISFI la verificación de identidad y número para WhatsApp, y decidir
   si se requerirá verificación del correo.
3. Preparar backups cifrados, restauración probada, retención de auditoría, alertas,
   límites de gasto y separación de entornos antes de un piloto.
4. Confirmar las reglas funcionales pendientes y ejecutar aceptación integral en
   escritorio y móvil con datos ficticios.

## Decisiones pendientes para LISFI

- Designar responsables para administrar privilegios y recuperar cuentas; definir
  si existirá un rol elevado separado del administrador habitual.
- Confirmar si los dos aprobadores deben ser distintos del solicitante y la política
  cuando se revoca a un aprobador o al solicitante mientras una solicitud está pendiente.
- Definir verificación operativa de identidad y número de WhatsApp, y retención de auditoría.
- Definir el contexto competitivo de temporadas y cuándo pueden coexistir activas.
- Acordar nombres operativos de clubes, normalización y unicidad.
- Confirmar si la nómina nominal de jugadores actualmente presente en el módulo de
  clubes pertenece a esta etapa. La especificación original reserva los flujos de
  fichajes y los datos de menores para etapas posteriores; no cargar datos reales de
  menores sin definir acceso, retención y revisión legal.

## Precauciones para el piloto

Las aprobaciones actuales se aplican mediante un trigger y un lote atómico D1. El
adaptador de autenticación no ofrece transacciones interactivas: los nuevos flujos
de usuarios deben demostrar su consistencia y rollback sin suponer esa capacidad.
No guardar documentos de identidad, información médica ni secretos en auditoría.
Probar aislamiento, revocación y restauración antes de usar datos reales. Cualquier
despliegue o creación de recursos remotos requiere confirmación del usuario.
