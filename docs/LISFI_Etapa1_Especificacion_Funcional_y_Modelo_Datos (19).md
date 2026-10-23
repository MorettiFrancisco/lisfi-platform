# LISFI — Etapa 1: especificación funcional y modelo de datos

**Versión:** 0.1 · **Estado:** propuesta para validación · **Fecha:** octubre de 2026  
**Alcance:** fundamento de la plataforma multi-club y preparación del módulo de fichajes.

## 1. Objetivo y decisiones confirmadas

Desarrollar una **única aplicación web multi-club** para LISFI, con una sola API y base de datos. Cada club accede exclusivamente a su información permitida. La administración central gestiona clubes y delegados.

**Decisiones confirmadas**

1. Puede haber **múltiples administradores LISFI** con cuentas personales.
2. Un club puede tener **múltiples delegados**; un delegado podrá vincularse a más de un club, sujeto a autorización de LISFI.
3. Los **fichajes se renuevan por temporada**; la identidad del jugador y del responsable persiste entre temporadas.
4. Los delegados inician fichajes; el adulto responsable realiza una autorización separada.
5. Para una etapa posterior está elegido el mecanismo de **revisión documental manual** (DNI y evidencia del vínculo) por LISFI; su suficiencia legal requiere validación.
6. La documentación médica sigue bajo custodia física de la Liga; la plataforma solo registra el estado administrativo de aptitud, cuando se implemente.

## 2. Alcance y límites de la Etapa 1

### Incluido

- Repositorio y arquitectura modular (Vue 3/TypeScript; Hono/Workers; D1/Drizzle).
- Entornos de desarrollo y producción, migraciones y despliegue automatizado.
- Autenticación con solución probada, sesiones seguras, recuperación de acceso y protección contra abuso.
- Roles `LEAGUE_ADMIN` y `CLUB_DELEGATE`; permisos efectivos por membresía de club.
- Alta, edición, desactivación y consulta paginada de clubes.
- Alta/invitación, activación y desactivación de usuarios, con asignación/revocación de delegaciones.
- Alta y consulta de temporadas; una temporada activa por contexto competitivo definido por LISFI.
- Registro de auditoría de acciones administrativas críticas.
- Esquema y migraciones iniciales que anticipan jugadores, responsables, fichajes y autorizaciones.
- Pruebas automáticas de aislamiento entre clubes y procedimientos documentados de backup/restore.

### Fuera de alcance de esta entrega

- Formularios completos de fichajes y subida de DNI, revisión documental, OTP y consentimiento real (Etapa 2).
- Torneos, categorías deportivas, fixtures, actas, árbitros y estadísticas.
- Publicación de datos de jugadores en la web pública.
- Integración RENAPER, firma digital y carga de certificados médicos.

**Criterio de límite:** el modelo de datos futuro puede quedar definido, pero solo se construyen pantallas y endpoints de clubes, usuarios, membresías y temporadas. No recolectar datos reales de menores en el entorno de pruebas.

## 3. Actores

| Actor | Alcance | Restricciones |
|---|---|---|
| Administrador LISFI | Administra clubes, usuarios, asignaciones y temporadas | La cuenta es individual; acciones auditadas; no se comparte contraseña |
| Delegado | Accede a los clubes de sus membresías vigentes | No puede asignarse a clubes ni elevar permisos |
| Adulto responsable (Etapa 2) | Autoriza fichajes de menores que representa | Sin privilegios de delegado ni administrador |
| Revisor documental (Etapa 2) | Valida evidencia por delegación de LISFI | Rol separado por mínimo privilegio |
| Visitante | Web pública | No accede a DNI, contactos, documentos ni autorizaciones |

Un usuario puede pertenecer a varios clubes. Se recomienda que el rol administrativo sea global y que el rol delegado se conceda por membresía; **no** un simple `role` editable en el cliente.

## 4. Requisitos funcionales (Etapa 1)

| ID | Requisito | Prioridad | Verificación |
|---|---|---|---|
| RF-01 | Iniciar y cerrar sesión con cuenta individual | Alta | Sesión caduca y puede revocarse |
| RF-02 | Recuperar acceso por canal verificado | Alta | No revela existencia de cuenta |
| RF-03 | LISFI crea y edita un club con nombre único operativo y slug único | Alta | Validaciones y conflicto 409 |
| RF-04 | LISFI desactiva un club sin borrar su historial | Alta | Club desactivado no admite nuevas acciones |
| RF-05 | LISFI invita usuarios y asigna uno o varios clubes | Alta | Invitación de un solo uso y con vencimiento |
| RF-06 | LISFI revoca una membresía de delegado | Alta | Pierde acceso inmediatamente tras revocación |
| RF-07 | Delegado ve exclusivamente sus clubes y sus datos autorizados | Alta | Acceso a club ajeno devuelve 403/404 |
| RF-08 | LISFI crea, activa, cierra y consulta temporadas | Alta | Estados coherentes y no se borra historial |
| RF-09 | Acciones críticas quedan auditadas | Alta | Actor, acción, recurso, fecha y cambio relevante |
| RF-10 | Listados admiten paginación, búsqueda y orden controlado | Media | Sin exponer datos de otros clubes |
| RF-11 | Interfaz usable desde móviles | Media | Flujos esenciales probados en 360 px |

### Reglas de negocio

- **RB-01:** un administrador puede gestionar varios clubes; múltiples administradores pueden coexistir.
- **RB-02:** un club puede tener N delegados y un delegado puede tener N clubes.
- **RB-03:** no se permite una segunda membresía activa equivalente `(user_id, club_id, role)`.
- **RB-04:** no se eliminan físicamente clubes, temporadas ni usuarios con referencias históricas; se desactivan.
- **RB-05:** los registros de un año anterior siguen consultables aunque la nueva temporada esté activa.
- **RB-06:** un fichaje futuro será único por `(player_id, season_id, club_id)` para un intento inicial, pero debe permitir reenvíos/correcciones con historial; las transferencias y duplicados entre clubes se bloquearán por reglas acordadas.
- **RB-07:** un fichaje nunca se considera aprobado solo porque el delegado lo cargó; requiere autorización del responsable y validación de LISFI.
- **RB-08:** el registro de salud no contiene diagnósticos ni documentos clínicos salvo futura decisión expresa y revisión legal.

## 5. Permisos iniciales

| Operación | Admin LISFI | Delegado del club | Delegado de otro club | Responsable |
|---|---|---|---|---|
| Crear/modificar clubes | Sí | No | No | No |
| Invitar administradores | Solo admin con permiso elevado* | No | No | No |
| Invitar/revocar delegados | Sí | No | No | No |
| Ver detalle administrativo de club | Sí | Su club | No | No |
| Crear/editar temporadas | Sí | No | No | No |
| Consultar temporada actual | Sí | Sí | Sí | Pública si se decide |
| Crear solicitud de fichaje (Etapa 2) | Sí | Su club | No | No |
| Aprobar fichaje (Etapa 2) | Sí, si autorizado | No | No | No |
| Autorizar como padre/madre (Etapa 2) | Solo como representante acreditado | Solo como representante acreditado | Idem | Sí, sobre su vínculo |

\* **Decisión de seguridad propuesta:** `LEAGUE_OWNER`/`MANAGE_ADMINS` para asignación de nuevos administradores y prevención de escalación. LISFI debe designar dos responsables iniciales y un mecanismo de recuperación.

La autorización se verifica **en cada endpoint y en cada consulta**, no solo ocultando botones. El `club_id` permitido se deriva de sesión y membresía activa, nunca se acepta como autorización suficiente un valor enviado por el navegador.

## 6. Flujos de usuario

### F1. Crear club

1. Administrador inicia sesión; abre **Clubes > Nuevo**.
2. Ingresa nombre, nombre corto opcional, slug y datos institucionales mínimos.
3. API valida permiso, campos y unicidad, y registra club activo.
4. Sistema audita la creación y muestra el club.

**Errores:** nombre/slug inválido, slug duplicado, falta de permisos, caída de API.

### F2. Invitar delegado

1. Administrador selecciona club y usuario existente o crea una invitación por email.
2. Selecciona membresía `CLUB_DELEGATE` para ese club.
3. Usuario acepta invitación de un solo uso y establece sus credenciales de forma segura.
4. La membresía queda activa; el delegado ve ese club en su selector de contexto.

**Protecciones:** caducidad, reenvío controlado, límites de intentos, no revelar datos de usuarios ajenos.

### F3. Cambiar de club

1. Un delegado con varias membresías selecciona club A o B.
2. El frontend actualiza el contexto visible.
3. La API verifica membresía para cada solicitud, independientemente del selector.

**Prueba negativa:** cambiar manualmente el identificador de club en HTTP nunca habilita operaciones sobre un club no autorizado.

### F4. Crear temporada

1. Administrador crea temporada con nombre, año y fechas.
2. La temporada comienza en `DRAFT`; se habilita mediante transición controlada a `ACTIVE`.
3. La anterior puede pasar a `CLOSED`, conservando fichajes y estadísticas históricas.

**Pendiente:** definir si puede existir más de una temporada simultáneamente activa (por torneos paralelos). Hasta confirmación, no imponer una restricción global irreversible.

## 7. Modelo relacional inicial

### Núcleo implementable en Etapa 1

| Tabla | Campos centrales | Relación/índice |
|---|---|---|
| `users` | `id`, `email`, `display_name`, `status`, `created_at`, `updated_at` | `email` único normalizado |
| `auth_accounts` / tablas del proveedor | Identidad del proveedor y referencia a `users` | Según biblioteca de autenticación; evitar esquema casero |
| `global_role_assignments` | `id`, `user_id`, `role`, `granted_by`, `created_at`, `revoked_at` | Roles globales auditables |
| `clubs` | `id`, `name`, `short_name`, `slug`, `status`, `created_at`, `updated_at` | `slug` único |
| `club_memberships` | `id`, `user_id`, `club_id`, `role`, `status`, `created_at`, `revoked_at` | Índices por usuario/club; evitar membresías activas duplicadas |
| `seasons` | `id`, `name`, `year`, `start_date`, `end_date`, `status`, `created_at` | Año no necesariamente único; validar fechas |
| `invitations` | `id`, `email`, `club_id`, `role`, `token_hash`, `expires_at`, `accepted_at`, `invited_by` | Token aleatorio; solo hash en BD |
| `audit_logs` | `id`, `actor_user_id`, `action`, `resource_type`, `resource_id`, `club_id`, `created_at`, `metadata_json` | Índices por actor y recurso |

### Extensiones diseñadas, **no implementadas** en Etapa 1

| Tabla | Campos principales | Regla importante |
|---|---|---|
| `players` | `id`, `dni`, `first_name`, `last_name`, `birth_date` | Identidad no depende del club ni de la temporada |
| `guardians` | `id`, `dni`, `first_name`, `last_name`, `email`, `phone` | Un adulto puede representar varios menores |
| `player_guardians` | `id`, `player_id`, `guardian_id`, `relationship`, `verification_status`, `verified_by`, `verified_at` | Relación explícita, revisable y revocable |
| `registrations` | `id`, `player_id`, `club_id`, `season_id`, `status`, `submitted_by`, `submitted_at`, `approved_by`, `approved_at` | Renovación = nuevo registro en nueva temporada |
| `authorization_requests` | `id`, `registration_id`, `guardian_id`, `status`, `expires_at`, `created_at` | Nunca autoriza el delegado automáticamente |
| `consents` | `id`, `authorization_request_id`, `terms_version`, `document_hash`, `accepted_at`, `verification_method` | Consentimiento de inscripción separado del de publicación |
| `identity_reviews` | `id`, `guardian_id`, `status`, `reviewed_by`, `reviewed_at`, `evidence_expiry_at` | Identidad y vínculo son revisiones distintas |
| `document_objects` | `id`, `owner_type`, `owner_id`, `r2_key`, `purpose`, `retention_until`, `deleted_at` | No guardar URL pública ni contenido binario en D1 |
| `medical_clearances` | `id`, `player_id`, `season_id`, `status`, `verified_at`, `expires_at`, `verified_by` | Sin resultados clínicos ni estudios |

**Decisión a validar:** DNI único en `players` y `guardians` con reglas para extranjeros/documentos especiales; no imponer `NOT NULL UNIQUE` irreversiblemente antes del relevamiento.

### DDL orientativo para el núcleo

```sql
-- Boceto SQLite/D1. La migración definitiva debe generarse con Drizzle
-- e integrarse con el modelo de autenticación seleccionado.
CREATE TABLE users (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  display_name TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'ACTIVE'
    CHECK (status IN ('INVITED','ACTIVE','SUSPENDED')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE clubs (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  short_name TEXT,
  slug TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL DEFAULT 'ACTIVE'
    CHECK (status IN ('ACTIVE','INACTIVE')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE club_memberships (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  club_id TEXT NOT NULL REFERENCES clubs(id),
  role TEXT NOT NULL CHECK (role IN ('CLUB_DELEGATE')),
  status TEXT NOT NULL CHECK (status IN ('ACTIVE','REVOKED')),
  created_at TEXT NOT NULL,
  revoked_at TEXT
);

CREATE UNIQUE INDEX uq_active_club_membership
ON club_memberships(user_id, club_id, role)
WHERE status = 'ACTIVE';

CREATE INDEX idx_memberships_club_status
ON club_memberships(club_id, status);

CREATE TABLE seasons (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  year INTEGER NOT NULL,
  start_date TEXT NOT NULL,
  end_date TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('DRAFT','ACTIVE','CLOSED')),
  created_at TEXT NOT NULL,
  CHECK (start_date <= end_date)
);

CREATE TABLE global_role_assignments (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  role TEXT NOT NULL CHECK (role IN ('LEAGUE_OWNER','LEAGUE_ADMIN')),
  granted_by TEXT REFERENCES users(id),
  created_at TEXT NOT NULL,
  revoked_at TEXT
);

CREATE UNIQUE INDEX uq_active_global_role
ON global_role_assignments(user_id, role)
WHERE revoked_at IS NULL;

CREATE TABLE audit_logs (
  id TEXT PRIMARY KEY,
  actor_user_id TEXT REFERENCES users(id),
  action TEXT NOT NULL,
  resource_type TEXT NOT NULL,
  resource_id TEXT NOT NULL,
  club_id TEXT REFERENCES clubs(id),
  metadata_json TEXT,
  created_at TEXT NOT NULL
);
```

**Convenciones:** IDs aleatorios UUID/ULID; fechas en ISO-8601 UTC; email normalizado en el servicio; índices adicionales según consultas reales. `audit_logs` registra metadatos mínimos, nunca fotos de DNI ni información médica. Esquema simplificado y sujeto a revisión técnica.

## 8. API inicial (orientativa)

| Método | Ruta | Autorización | Resultado |
|---|---|---|---|
| `GET` | `/api/me` | Autenticado | Usuario, roles y clubes permitidos |
| `GET` | `/api/clubs` | Admin o delegado | Lista filtrada por permisos |
| `POST` | `/api/clubs` | Admin | Nuevo club |
| `PATCH` | `/api/clubs/:id` | Admin | Modificación validada |
| `POST` | `/api/clubs/:id/delegates/invitations` | Admin | Invitación temporal |
| `GET` | `/api/clubs/:id/delegates` | Admin | Delegados asociados |
| `DELETE` | `/api/clubs/:id/delegates/:membershipId` | Admin | Revocación lógica |
| `GET` | `/api/seasons` | Autenticado | Temporadas |
| `POST` | `/api/seasons` | Admin | Nueva temporada |
| `PATCH` | `/api/seasons/:id` | Admin | Cambio de estado permitido |
| `GET` | `/api/audit-logs` | Admin autorizado | Lista paginada y filtrada |

Para mutaciones: validación Zod; códigos HTTP apropiados (`400`, `401`, `403`, `404`, `409`, `422`); errores sin datos sensibles; límites de tasa para login e invitaciones; protección CSRF si se usan cookies. Endpoints críticos idempotentes cuando corresponda.

## 9. No funcionales y seguridad

- **NFR-01 Aislamiento:** todas las consultas de delegado restringidas a clubes con membresía `ACTIVE`.
- **NFR-02 Seguridad:** TLS; cookies HttpOnly/Secure/SameSite; MFA para administradores; secretos fuera del repositorio.
- **NFR-03 Privacidad:** mínimo de datos personales; acceso a documentos de Etapa 2 solo a revisores habilitados; no publicar DNI.
- **NFR-04 Trazabilidad:** eventos de altas, roles, revocaciones y aprobaciones no editables desde UI.
- **NFR-05 Recuperación:** copias cifradas fuera del mismo entorno, política de retención y restauración ensayada antes del piloto.
- **NFR-06 Calidad:** tests unitarios de reglas, integración de autorización y E2E de login/clubes.
- **NFR-07 Operación:** logs estructurados sin PII, alertas de errores, monitoreo de cuotas y límites presupuestarios.
- **NFR-08 Disponibilidad:** diseño responsive y tolerancia a interrupciones; definir SLA/continuidad formal para producción con LISFI.
- **NFR-09 Entornos:** nunca usar documentos reales de menores en pruebas.

### Requisito legal previo al uso real

Antes de registrar datos reales de menores o recibir DNI en R2, LISFI debe revisar con asesoramiento competente: textos de consentimiento y representación; responsabilidades de Liga/clubes/desarrollador; conservación; registro de bases de datos; transferencias internacionales; DPA del proveedor; derechos de titulares; y validez del procedimiento de autorización electrónica.

## 10. Criterios de aceptación (Definition of Done)

1. Dos administradores distintos pueden iniciar sesión y gestionar clubes con trazabilidad individual.
2. Un club A admite al menos dos delegados con cuentas independientes.
3. Un delegado asociado a clubes A y B puede cambiar de contexto y operar en ambos.
4. Un delegado de A no accede ni por URL ni por API a datos internos de B si no está asignado.
5. Un administrador puede revocar un delegado y el acceso desaparece incluso con una sesión previa.
6. Se puede crear y cerrar una temporada sin borrar las temporadas históricas.
7. Las migraciones se ejecutan desde cero en desarrollo y en ambiente de prueba.
8. CI ejecuta lint, chequeo de tipos y tests relevantes; el despliegue se realiza desde una rama controlada.
9. Se realiza y documenta una restauración exitosa de backup de prueba.
10. El flujo se demuestra en una pantalla móvil y una de escritorio.

## 11. Plan de ejecución

| Bloque | Trabajo | Estimación |
|---|---|---|
| A | Relevamiento y decisiones abiertas; permisos; modelo | 8–12 h |
| B | Monorepo, entornos, migraciones, CI, despliegue | 12–18 h |
| C | Auth y roles, clubes, invitaciones, temporadas | 16–24 h |
| D | Pruebas de aislamiento, auditoría, backup/restore | 8–12 h |

**Total preliminar:** 44–66 horas; aproximadamente 2–4 semanas a 20 h/semana. No incluye integración documental de Etapa 2 ni tiempos externos para autorizaciones legales.

## 12. Decisiones pendientes para LISFI (no bloquear el repositorio)

1. ¿Quién puede designar/revocar administradores globales? Propuesta: solo dos `LEAGUE_OWNER`.
2. ¿Un club puede estar inactivo mientras se conservan sus fichajes históricos? Propuesta: sí.
3. ¿Temporadas coincidentes o múltiples competiciones por año? Evitar restricción de única activa hasta responder.
4. ¿Campos obligatorios y denominaciones legales de cada club? Confirmar padrón oficial.
5. ¿Qué documentación demuestra la representación de un menor en el flujo digital? Procedimiento jurídico-administrativo pendiente.
6. ¿Quién revisa DNI y vínculo: personal central de LISFI o personas delegadas? Propuesta: solo revisores LISFI.
7. ¿Plazos de retención de imágenes de DNI y autorizaciones? Deben fijarse formalmente antes de Etapa 2.
8. ¿Qué contenido deportivo de menores puede hacerse público? Definir autorización separada.

## 13. Siguiente tarea recomendada

Crear el repositorio y una prueba vertical pequeña: login de dos administradores, alta de club, invitación de dos delegados y comprobación automatizada de que un delegado ajeno recibe `403/404`. Esa prueba validará la elección de biblioteca de autenticación, ORM y Workers/D1 antes de ampliar el dominio.
