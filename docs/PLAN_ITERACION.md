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

## Bloqueos para completar el circuito de clubes

El bootstrap crea un solo administrador y no existe todavía un flujo para dar de alta
un segundo. Por lo tanto, una instalación nueva no puede completar desde la interfaz
la doble aprobación exigida para crear clubes. Tampoco existe el flujo para invitar
representantes, verificar su correo o revocar su membresía. El sistema exige una
cuenta activa y con correo verificado para aplicar una asignación de representante.

## Próximas entregas propuestas

1. **Seguridad y calidad de la base.** Corregir los hallazgos de privacidad de la
   auditoría actual, mantener las verificaciones de doble aprobación y el aislamiento
   entre clubes, y dejar `pnpm check` reproducible en Windows y CI. Verificar las
   migraciones y sus restricciones desde una base vacía y desde una base existente.
2. **Administradores y recuperación.** Acordar quién puede otorgar o revocar el
   privilegio de administración y cómo recuperar el acceso; implementar el segundo
   administrador mediante un flujo auditado, con cuentas personales y MFA. Evitar
   que una revocación deje a LISFI sin responsables habilitados.
3. **Invitaciones y representantes.** Elegir canal de correo verificado y proveedor;
   implementar invitaciones de un solo uso y con vencimiento, aceptación, reenvío
   limitado, asignación y revocación lógica auditadas. Probar un club con dos
   representantes, uno asociado a dos clubes y acceso denegado a un club ajeno.
4. **Recuperación y operación.** Agregar recuperación sin revelar si una cuenta
   existe, control de abuso, alertas, límites presupuestarios y un procedimiento de
   backup cifrado con una restauración de prueba documentada. Decidir el enrutamiento
   Pages/Worker y separar entornos antes de preparar cualquier piloto.
5. **Cierre funcional.** Confirmar nombres y campos oficiales de clubes y reglas
   de temporadas simultáneas; completar controles de unicidad y los flujos pendientes.
   Ejecutar pruebas de aceptación completas en escritorio y móvil con datos ficticios.

## Decisiones pendientes para LISFI

- Designar responsables para administrar privilegios y recuperar cuentas; definir
  si existirá un rol elevado separado del administrador habitual.
- Confirmar si los dos aprobadores deben ser distintos del solicitante y la política
  cuando se revoca a un aprobador o al solicitante mientras una solicitud está pendiente.
- Definir canal y costo de invitaciones y recuperación, así como retención de auditoría.
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
