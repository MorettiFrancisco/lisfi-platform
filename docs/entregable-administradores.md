# Invitación de administradores

El administrador creado en el alta inicial puede invitar a otro administrador
después de iniciar sesión y verificar MFA. El invitado recibe una clave por el canal
privado que elija LISFI, crea una cuenta individual con su propia contraseña y activa
MFA antes de acceder a funciones administrativas. La clave es aleatoria, de 256 bits,
se muestra una vez, se guarda mediante SHA-256 y caduca en una hora.

El correo de la invitación debe coincidir con el ingresado por el destinatario.
No se afirma que el correo esté verificado: no hay proveedor de correo integrado.
El flujo acepta cuentas nuevas; la promoción de una cuenta existente queda pendiente.
La creación y aceptación quedan registradas, sin guardar la clave ni el correo en los
metadatos de auditoría. La aceptación consume la clave y crea usuario, credencial,
rol y auditoría en un batch D1. La base revalida que el emisor siga activo, tenga el
rol vigente y MFA verificado. Los intentos fallidos se limitan por IP.

La capacidad de invitar está limitada al usuario del bootstrap. Es una política
provisional para evitar que cualquier administrador pueda conceder privilegios; LISFI
debe definir responsables adicionales, recuperación y revocación administrativa.
Las claves pendientes no tienen revocación manual y dejan de funcionar al vencer o
si el emisor pierde las condiciones requeridas.

## Verificación

- `pnpm check`: 38 pruebas Vitest, lint, tipos y builds aprobados.
- Playwright: 19 pruebas aprobadas y una omitida por diseño. El flujo real crea al
  primer administrador, invita al segundo, verifica su MFA y aplica un alta de club
  mediante dos aprobaciones, con cuentas y base temporales.
- Las pruebas de API cubren autorización, MFA, correo distinto, caducidad, repetición,
  revocación del emisor, solicitudes simultáneas y rollback cuando falla la auditoría.
- Migración 0008 aplicada en D1 local. No se creó infraestructura ni se desplegó.
