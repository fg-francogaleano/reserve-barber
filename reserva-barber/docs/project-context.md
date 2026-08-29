# Project Context

## Overview
**Reserva Barber** es una aplicación web para la gestión de reservas de barberías. Está pensada para ser administrada por un **propietario** (dueño de un conglomerado de barberías) que emplea a uno o más barberos distribuidos en uno o más locales. El propietario administra todo desde un **dashboard privado**, y comparte un **enlace público** con sus clientes; al abrir ese enlace se renderiza el **flujo de reserva de turnos**.

El producto tiene, entonces, dos caras:
1. **Dashboard de administración** (privado, para el propietario): gestión de reservas, estadísticas, perfil público, servicios, barberos, locales y métodos de pago.
2. **Flujo público de reserva** (para clientes, sin cuenta): el cliente elige local, barbero, servicio y horario, y paga una seña obligatoria para confirmar el turno.

Los cobros se realizan mediante **Mercado Pago** (automático) o **transferencia bancaria** (con comprobante que el propietario aprueba manualmente). Toda la configuración de pago es única y compartida entre los locales.

## Target Users
- **Propietario / administrador (usuario autenticado):** dueño del negocio (o conglomerado). Es el único rol administrativo del sistema en esta versión. Gestiona locales, barberos, servicios, precios, disponibilidad, perfil público, métodos de cobro, aprueba comprobantes de transferencia, revisa estadísticas y administra reservas/cancelaciones.
- **Cliente final (invitado, sin cuenta):** persona que quiere reservar un turno. Accede por el enlace público, reserva como invitado dejando nombre, email y teléfono, paga la seña y recibe confirmación por email. Puede cancelar su turno desde un enlace con token enviado a su email.

> Nota: en esta versión **no** existe un rol para "barberos socios" que comparten un local ni un panel de acceso para los barberos. Los barberos son entidades administradas por el propietario, no usuarios del sistema.

## Core Features

### 1. Multi-local (un dueño, varios locales)
- Un único propietario administra **varios locales/sucursales** bajo su misma cuenta.
- **Cada barbero pertenece a un (1) solo local.**
- En el flujo de reserva, el cliente **elige primero el local** y luego ve únicamente los barberos de ese local.
- La configuración de pago (Mercado Pago + datos de transferencia) es **compartida por todos los locales** (una sola cuenta de MP y un solo CBU/CVU/alias a nivel propietario).

### 2. Flujo público de reserva (cliente invitado)
Flujo, paso a paso:
1. Cliente abre el enlace público → ve el **perfil público** de la barbería.
2. Elige **local**.
3. Elige **servicio** (solo se muestran servicios que tienen al menos un barbero asignado; un servicio sin barbero asignado **no** puede avanzar en el flujo).
4. Elige **barbero** (de ese local, habilitado para ese servicio).
5. Elige **fecha y horario** entre los slots disponibles.
6. Ingresa sus datos como invitado: **nombre, email, teléfono**.
7. Paga la **seña obligatoria** para confirmar (ver Pagos).
8. Recibe **email de confirmación**.
- **Edge case — concurrencia de slots:** al iniciar el pago, el horario se **bloquea provisoriamente** para evitar doble reserva del mismo slot.

### 3. Disponibilidad y calendario
- Cada barbero tiene un **horario laboral** definido por día (ej. Lun–Vie 9:00–18:00), con soporte para **días libres/excepciones**.
- Los **slots disponibles se generan dinámicamente** combinando el horario laboral del barbero, sus turnos ya reservados y la **duración del servicio** elegido.
- En el dashboard, el propietario ve una **tarjeta por barbero** y, al hacer clic, el **calendario individual** de ese barbero con sus turnos.

### 4. Pagos (seña obligatoria)
La reserva **requiere el pago de una seña** para quedar confirmada. Dos métodos:
- **Mercado Pago (automático):** el cliente paga online; un **webhook** de MP confirma el pago y la reserva pasa a *confirmada* automáticamente.
- **Transferencia bancaria (manual):** se muestran los datos (CBU/CVU/alias) y el cliente **sube un comprobante**. La reserva queda **pendiente de aprobación**:
  - El horario queda **reservado en estado provisorio** mientras el comprobante está pendiente.
  - El propietario ve los **"Comprobantes de transferencias pendientes"** en el dashboard y los **aprueba o rechaza**.
  - Si **rechaza**, el horario provisorio se **libera**.
- Configuración de cobro (a nivel propietario, compartida):
  - **Mercado Pago:** Access Token + Public Key.
  - **Transferencia:** formulario con CBU/CVU o Alias, que se expone en el flujo de reserva.

### 5. Cancelaciones
- Pueden cancelar **tanto el propietario** (desde el dashboard) **como el cliente**.
- El cliente cancela mediante un **enlace con token** enviado a su email (identifica al cliente invitado sin necesidad de cuenta).
- Las cancelaciones se contabilizan en las estadísticas.
- (La política de reembolso/manejo de la seña ante cancelación se define en la etapa de implementación; no bloquea la arquitectura.)

### 6. Notificaciones
- **Email de confirmación** al cliente al confirmarse la reserva (requiere integrar un servicio de email transaccional con free tier, p. ej. Resend).
- WhatsApp / SMS quedan **fuera de alcance** para el MVP.

### 7. Dashboard de administración
- **Inicio:** tarjetas resumen — Reservas para hoy, Cancelaciones de hoy, Reservas totales, Comprobantes de transferencia pendientes, Ingresos totales (mes en curso). Actividad reciente (últimas reservas) con **filtros por barbero** ("Todos" / "Barbero 1" / "Barbero 2" …) mostrando nombre, email, barbero y fecha de la reserva.
- **Perfil (público):** foto y portada del negocio, nombre de la barbería, biografía, enlaces y redes sociales, botón "Reservar". Esta información es la que ven los clientes en el enlace público.
- **Calendario:** una tarjeta por barbero → calendario individual al hacer clic.
- **Clientes:** tabla con Nombre, Teléfono, Email y cantidad de Reservas.
- **Estadísticas:** filtro por rango de tiempo (botones: hoy, ayer, esta semana, etc.). Tarjetas: reservas totales, ingresos totales, cancelaciones, promedio por turno, clientes únicos. Gráficos: evolución de ingresos, métodos de pago. Otras métricas: servicios más populares, personal más activo, distribución horaria de turnos (horarios más solicitados).
- **Servicios:** dos secciones — Servicios y Barberos. **Se deben crear los perfiles de barberos antes de que un servicio quede disponible en el flujo de reserva.** El sistema permite crear un servicio sin barbero asignado, pero ese servicio **no** avanza en el flujo de reserva hasta que se le asigne al menos un barbero.
- **Transferencia:** formulario para cargar CBU/CVU o Alias que se expone en el flujo de reserva.
- **Mercado Pago:** carga de Access Token y Public Key.

### 8. Almacenamiento de archivos
- **Imágenes de perfil** (foto y portada del negocio) y **comprobantes de transferencia** se guardan en **Supabase Storage**.

## Constraints
- **Hosting:** Cloudflare (Workers / Pages). Restricción dura.
- **Presupuesto:** debe **tender a cero** — priorizar free tiers de todos los servicios (Cloudflare, Supabase, email, etc.).
- **Skillset del desarrollador:** JavaScript / TypeScript, React / Next.js.
- **Runtime:** Cloudflare corre `workerd` (no Node.js puro) → las librerías del backend deben ser compatibles con el runtime edge de Cloudflare. En particular, **Prisma debe usar driver adapters** (`@prisma/adapter-pg`) conectando al **pooler de Supabase (Supavisor)**.
- **Alcance de la versión actual:** un solo rol administrativo (propietario). Sin panel para barberos ni modelo de "socios que comparten local".

## Stack Decisions

### Database
- **Chosen:** **Supabase (PostgreSQL)** con **Prisma ORM**. Almacenamiento de archivos en **Supabase Storage**.
- **Alternatives considered:** Cloudflare D1 (SQLite) + Drizzle; Turso (libSQL/SQLite).
- **Rationale:** El propietario prefiere Postgres + Prisma + Supabase, un combo muy productivo y con free tier acorde a presupuesto ~$0. Postgres es sólido para las consultas de estadísticas del dashboard (agregaciones, rangos de fechas, `GROUP BY`), y Supabase suma Storage integrado (imágenes y comprobantes) evitando un servicio adicional como R2. Se descartó D1/Drizzle pese a ser lo más nativo de Cloudflare porque el usuario ya optó por Supabase/Prisma. **Consideración de implementación:** al hostear en Cloudflare (`workerd`), Prisma debe usar driver adapters (`@prisma/adapter-pg`) sobre el pooler de Supabase (Supavisor).

### Backend
- **Chosen:** **Next.js (App Router) fullstack**, desplegado en **Cloudflare** (vía `@opennextjs/cloudflare`). API mediante Route Handlers y Server Actions.
- **Alternatives considered:** API separada con Hono sobre Cloudflare Workers + frontend React independiente.
- **Rationale:** El desarrollador ya domina Next.js (curva cero) y un único proyecto cubre las dos caras del producto (dashboard privado + flujo público). Los Route Handlers resuelven bien el webhook de Mercado Pago, la subida/aprobación de comprobantes y el envío de emails. Se descartó la API separada con Hono porque, a esta escala, agrega dos codebases y curva de aprendizaje sin beneficio real.

### Frontend
- **Chosen:** **Next.js (React) + Tailwind CSS + shadcn/ui**, con **Recharts/Tremor** para los gráficos de estadísticas.
- **Alternatives considered:** Mantine / MUI (librería de componentes completa); CSS a mano / CSS Modules.
- **Rationale:** La app es intensiva en UI (dashboard, tablas, formularios, calendario, gráficos). Tailwind + shadcn/ui es el estándar actual para paneles administrativos: gratis, accesible, control total del markup (los componentes viven en el repo) y muy productivo con Next.js. Recharts/Tremor cubren los gráficos de ingresos, métodos de pago y distribución horaria. Se descartó Mantine/MUI por bundle más pesado y menor control estético, y el CSS a mano por ser demasiado lento para construir todo el panel.
  > **D6 shipped the first two charts as server-rendered SVG instead**, because `/estadisticas`
  > carries a tested no-client-JavaScript requirement that no browser-measuring chart library can
  > satisfy. Recharts/Tremor stay available to the project and stop being the default for that page.
  > The full argument, and what would bring one back, is the Charts note in `frontend-standards.md`.

## Supporting Services (free tier)
- **Cloudflare** (Pages/Workers): hosting del app Next.js.
- **Supabase:** Postgres + Storage.
- **Mercado Pago:** cobros online (Checkout/Preferences + webhook) — credenciales cargadas por el propietario.
- **Email transaccional:** servicio con free tier (p. ej. **Resend**) para los emails de confirmación y el enlace de cancelación con token.
