# Auditoría técnica y revisión de código — 29 de octubre de 2026

Base revisada: `e5882486651e590c78f674da1eabbf22f44e37ce`. La revisión combinó
una auditoría independiente de GPT-6 Luna con esfuerzo alto y una revisión propia
del código, documentación y controles locales. No se inspeccionaron datos reales,
un despliegue remoto ni controles externos de Cloudflare.

## Hallazgos y correcciones

1. **Privacidad: enumeración de cuentas.** Una persona representante podía enviar
   correos al endpoint de solicitudes y distinguir si existía una cuenta activa y
   verificada por la respuesta HTTP. La corrección recibe la solicitud con respuesta
   uniforme y resuelve la cuenta solo al aplicar la segunda aprobación. La cuenta debe
   seguir activa y verificada en ese momento; el fallo no aplica la asignación.
2. **Privacidad: datos de solicitudes.** El listado entregaba a todos los
   representantes del club el nombre y correo de la persona propuesta. La corrección
   los omite en las respuestas para representantes y conserva el correo para la
   revisión de administradores autorizados.
3. **Minimización de auditoría.** El trigger anterior copiaba el contenido completo
   de la solicitud aplicada en `audit_logs`, incluidos nombres y correos. La migración
   nueva guarda tipo e identificadores en los eventos futuros. No altera ni elimina
   los eventos históricos, que requieren una decisión de retención separada.
4. **Comprobación de formato en Windows.** El checkout con CRLF hacía fallar
   `pnpm check` en 42 archivos. La configuración de Prettier acepta los saltos de
   línea existentes, sin modificar masivamente el código.
5. **Pruebas bajo carga.** Tres escenarios de MFA y doble aprobación superaron el
   límite anterior de cinco segundos al ejecutar D1 emulado y criptografía real en
   esta máquina. Se amplió el timeout de Vitest a 15 segundos; la suite completa
   pasó luego de ejecutarse de forma secuencial.

## Comprobaciones de diseño

- El endpoint de aprobación y el trigger revalidan rol administrativo, usuario
  activo y MFA. El índice único evita que la misma persona apruebe dos veces.
  Los efectos del cambio, su auditoría y la transición de estado se aplican en la
  operación del trigger. La revisión no encontró un bypass del quorum.
- Clubes y solicitudes consultadas por representantes están filtrados por membresía
  vigente y club activo. Las pruebas automatizadas existentes cubren cambios de
  membresía, expiración y suspensión; no equivalen a una prueba de penetración.
- Hay ventanas entre la autorización inicial y ciertas escrituras de creación o
  rechazo. No se reportan como bypass confirmado: falta definir qué debe ocurrir
  con una solicitud ya presentada al revocar al solicitante, y aún no existe una
  interfaz de revocación de roles. Revalidar estas operaciones al implementar bajas.
- El directorio de clubes contiene nombres de jugadores, potencialmente menores.
  Deben definirse finalidad, permisos, retención y revisión legal antes de cargar
  datos reales. El documento de alcance reserva los flujos de fichajes para después.

## Alcance operativo pendiente

El primer administrador puede iniciar sesión y configurar MFA, pero aún falta el
alta del segundo administrador, necesaria para completar la doble aprobación. También
faltan invitaciones, verificación de correo, recuperación de acceso, revocación de
representantes, pruebas de restauración y preparación de entornos remotos. La secuencia
propuesta y las decisiones de LISFI están en [PLAN_ITERACION.md](PLAN_ITERACION.md).

La auditoría no certifica preparación para producción. No se creó infraestructura
remota ni se realizó despliegue. El historial anterior de auditoría puede contener
los datos copiados por el trigger previo; tratar su retención según una decisión
explícita, sin eliminar registros silenciosamente.

## Verificación local

- `pnpm install --frozen-lockfile` pasó. `pnpm check` pasó formato, lint, tipos,
  34 tests y los builds del frontend y Worker (dry-run, sin publicación).
- Las pruebas de integración verifican respuesta uniforme para correo existente o
  ausente, ocultamiento por rol, compatibilidad con solicitudes anteriores y
  revalidación de estado y correo al aplicar. También comprueban rollback y metadatos.
- El agente de correcciones comprobó `drizzle-kit check` y aplicó las migraciones
  con SQLite desde cero y desde 0006 antes de probar el trigger 0007. Se aplicaron
  las migraciones pendientes 0002 a 0007 en D1 local; ninguna se aplicó en remoto.
- La ejecución inicial de Playwright tuvo 18 pruebas aprobadas, una omitida por
  diseño y una falla por una captura ornamental con el elemento desmontado. Se
  retiraron dos capturas sin quitar las aserciones funcionales. La repetición pasó:
  19 pruebas aprobadas y una omitida por diseño (el bootstrap singleton se prueba
  en escritorio y móvil dentro del mismo caso).
