/**
 * User-facing copy — Spanish (es-AR), isolated from logic per frontend-standards.md.
 * All identifiers stay in English; only the string values are Spanish.
 */
export const COPY = {
  // Shared by the error boundaries, which cover every route and so must never
  // name a particular one.
  common: {
    error: 'No pudimos cargar la página. Intentá de nuevo más tarde.',
    retry: 'Reintentar',
  },
  locations: {
    heading: 'Nuestras sucursales',
    empty: 'Todavía no hay sucursales cargadas.',
    manageHeading: 'Sucursales',
    nav: 'Sucursales',
    emptyManage:
      'Todavía no cargaste ninguna sucursal. Creá la primera para empezar a recibir reservas.',
    create: 'Nueva sucursal',
    edit: 'Editar',
    editLabel: (name: string) => `Editar ${name}`,
    inactiveBadge: 'Inactiva',
    notFound: 'La sucursal que buscás no existe.',
    form: {
      createHeading: 'Nueva sucursal',
      editHeading: 'Editar sucursal',
      nameLabel: 'Nombre',
      addressLabel: 'Dirección (opcional)',
      submit: 'Guardar',
      submitting: 'Guardando…',
      cancel: 'Cancelar',
      nameRequired: 'Ingresá un nombre para la sucursal.',
      nameLength: 'El nombre tiene que tener entre 2 y 120 caracteres.',
      addressTooLong: 'La dirección no puede superar los 255 caracteres.',
      duplicateName: 'Ya tenés una sucursal con ese nombre.',
      limitReached: 'Llegaste al máximo de sucursales. Editá una existente en lugar de crear otra.',
      infrastructureError: 'No pudimos guardar los cambios. Intentá de nuevo más tarde.',
    },
  },
  barbers: {
    heading: 'Barberos',
    nav: 'Barberos',
    empty: 'Todavía no hay barberos cargados.',
    emptyNoLocations: 'Primero tenés que crear al menos una sucursal para poder agregar barberos.',
    create: 'Nuevo barbero',
    edit: 'Editar',
    editLabel: (name: string) => `Editar ${name}`,
    inactiveBadge: 'Sucursal inactiva',
    notFound: 'El barbero que buscás no existe.',
    noLocationsForForm: 'Antes de registrar un barbero, creá al menos una sucursal.',
    form: {
      createHeading: 'Nuevo barbero',
      editHeading: 'Editar barbero',
      nameLabel: 'Nombre',
      locationLabel: 'Sucursal',
      bioLabel: 'Descripción (opcional)',
      inactiveLocationMarker: '(inactiva)',
      submit: 'Guardar',
      submitting: 'Guardando…',
      cancel: 'Cancelar',
      nameRequired: 'Ingresá un nombre para el barbero.',
      nameLength: 'El nombre tiene que tener entre 2 y 120 caracteres.',
      bioTooLong: 'La descripción no puede superar los 500 caracteres.',
      locationRequired: 'Seleccioná una sucursal.',
      locationUnavailable: 'La sucursal seleccionada no está disponible.',
      duplicateName: (locationName: string) =>
        `Ya hay un barbero con ese nombre en ${locationName}.`,
      limitReached: 'Llegaste al máximo de barberos para esta sucursal.',
      infrastructureError: 'No pudimos guardar los cambios. Intentá de nuevo más tarde.',
    },
  },
  services: {
    heading: 'Servicios',
    nav: 'Servicios',
    empty: 'Todavía no cargaste ningún servicio. Creá el primero para poder ofrecerlo.',
    create: 'Nuevo servicio',
    edit: 'Editar',
    editLabel: (name: string) => `Editar ${name}`,
    notFound: 'El servicio que buscás no existe.',
    duration: (minutes: number) => `${minutes} min`,
    // Never colour alone: the marker carries its own text and is announced as
    // part of the service's description.
    notBookableBadge: 'No reservable',
    notBookableHint: 'Asignale al menos un barbero activo para que se pueda reservar.',
    form: {
      createHeading: 'Nuevo servicio',
      editHeading: 'Editar servicio',
      nameLabel: 'Nombre',
      priceLabel: 'Precio',
      durationLabel: 'Duración (minutos)',
      descriptionLabel: 'Descripción (opcional)',
      // Idle-state hints: a rule the owner can only discover by breaking it is
      // a rule stated badly.
      priceHint: 'Sin separador de miles. Ejemplo: 4500,50',
      durationHint: 'En múltiplos de 5 minutos, entre 5 y 480.',
      submit: 'Guardar',
      submitting: 'Guardando…',
      cancel: 'Cancelar',
      nameRequired: 'Ingresá un nombre para el servicio.',
      nameLength: 'El nombre tiene que tener entre 2 y 120 caracteres.',
      descriptionTooLong: 'La descripción no puede superar los 500 caracteres.',
      priceRequired: 'Ingresá un precio.',
      priceInvalid: 'El precio no es válido. Escribí solo números, por ejemplo 4500,50.',
      priceThousandsSeparator:
        'No uses separador de miles. Para cuatro mil quinientos escribí 4500, y para los centavos usá coma: 4500,50.',
      priceTooManyDecimals: 'El precio puede tener como máximo 2 decimales.',
      priceTooLarge: 'El precio no puede superar los $ 9.999.999,99.',
      durationRequired: 'Ingresá una duración.',
      durationInvalid: 'La duración tiene que ser un número entero de minutos.',
      durationOutOfRange: 'La duración tiene que estar entre 5 y 480 minutos.',
      durationNotMultiple: 'La duración tiene que ser múltiplo de 5 minutos.',
      duplicateName: 'Ya tenés un servicio con ese nombre.',
      limitReached:
        'Llegaste al máximo de servicios activos. Editá uno existente en lugar de crear otro.',
      // A timed-out write may still have been committed, so a blind retry would
      // meet the duplicate error and report a success as a failure.
      infrastructureError:
        'No pudimos guardar los cambios. Revisá la lista de servicios antes de reintentar, por las dudas de que se haya guardado.',
    },
  },
  barberServices: {
    heading: (barberName: string) => `Servicios de ${barberName}`,
    intro:
      'Elegí qué servicios realiza este barbero. Un servicio sin barbero activo asignado no se puede reservar.',
    legend: 'Servicios que realiza',
    manage: 'Servicios asignados',
    manageLabel: (barberName: string) => `Editar los servicios de ${barberName}`,
    assignedCount: (count: number) => (count === 1 ? '1 servicio' : `${count} servicios`),
    inactiveMarker: '(inactivo)',
    barberNotFound: 'El barbero que buscás no existe.',
    // The editor is not operable at all without a catalogue, so this is an
    // empty state with a way out, never a form with no options.
    emptyNoServices: 'Antes de asignar servicios, creá al menos uno en el catálogo.',
    createService: 'Nuevo servicio',
    submit: 'Guardar',
    submitting: 'Guardando…',
    cancel: 'Cancelar',
    // A malformed submission cannot come from the form, so the remedy is a
    // reload rather than a correction the owner could make by hand.
    invalidSelection: 'La selección no es válida. Recargá la página e intentá de nuevo.',
    tooMany: 'Seleccionaste demasiados servicios.',
    serviceUnavailable: (serviceName: string) =>
      `«${serviceName}» ya no está disponible y no se puede asignar. Recargá la página.`,
    serviceUnknown:
      'Alguno de los servicios seleccionados ya no está disponible. Recargá la página.',
    // A timed-out write may still have committed, so a blind retry would hide
    // a save that already happened.
    infrastructureError:
      'No pudimos guardar los cambios. Revisá los servicios asignados antes de reintentar, por las dudas de que se haya guardado.',
  },
  workingHours: {
    heading: (barberName: string) => `Horarios de ${barberName}`,
    intro:
      'Definí en qué horario trabaja este barbero cada día. Un día sin horario es un día que no trabaja.',
    legend: 'Horario semanal',
    manage: 'Horarios',
    manageLabel: (barberName: string) => `Editar los horarios de ${barberName}`,
    hasSchedule: 'Con horario',
    noSchedule: 'Sin horario',
    // True whether the schedule was never set or deliberately left empty: both
    // are zero rows, and the product does not distinguish them.
    noScheduleHint: 'Sin horario cargado no se le pueden reservar turnos.',
    startLabel: 'Desde',
    endLabel: 'Hasta',
    dayNames: {
      0: 'Domingo',
      1: 'Lunes',
      2: 'Martes',
      3: 'Miércoles',
      4: 'Jueves',
      5: 'Viernes',
      6: 'Sábado',
    } as Record<number, string>,
    barberNotFound: 'El barbero que buscás no existe.',
    submit: 'Guardar',
    submitting: 'Guardando…',
    cancel: 'Cancelar',
    dayIncomplete: 'Completá las dos horas o dejá el día vacío.',
    dayEndNotAfterStart: 'La hora de fin tiene que ser posterior a la de inicio.',
    dayNotOnGrid: 'Las horas tienen que ser múltiplos de 5 minutos.',
    dayOutOfDay: 'La hora no es válida.',
    invalidSelection: 'El horario enviado no es válido. Recargá la página e intentá de nuevo.',
    // A timed-out write may still have committed, so a blind retry would hide a
    // save that already happened. The retry itself is safe: the write replaces.
    infrastructureError:
      'No pudimos guardar los cambios. Revisá el horario antes de reintentar, por las dudas de que se haya guardado.',
  },
  timeOff: {
    heading: (barberName: string) => `Ausencias de ${barberName}`,
    intro:
      'Registrá los días u horas en que este barbero no está disponible. Dejá las horas vacías para marcar días completos.',
    manage: 'Ausencias',
    manageLabel: (barberName: string) => `Editar las ausencias de ${barberName}`,
    listHeading: 'Ausencias registradas',
    empty: 'Todavía no registraste ninguna ausencia para este barbero.',
    formHeading: 'Nueva ausencia',
    startDateLabel: 'Desde',
    endDateLabel: 'Hasta',
    startTimeLabel: 'Hora de inicio (opcional)',
    endTimeLabel: 'Hora de fin (opcional)',
    reasonLabel: 'Motivo (opcional)',
    // The "hasta" field is inclusive when no times are given, and the copy has
    // to say so — otherwise the owner has to discover it by losing a day.
    wholeDayHint: 'Si dejás las horas vacías, se toman los días completos, incluido el último.',
    allDay: 'Todo el día',
    submit: 'Agregar',
    submitting: 'Agregando…',
    remove: 'Eliminar',
    removeLabel: (range: string) => `Eliminar la ausencia del ${range}`,
    barberNotFound: 'El barbero que buscás no existe.',
    startDateRequired: 'Ingresá la fecha de inicio.',
    endDateRequired: 'Ingresá la fecha de fin.',
    invalidDate: 'La fecha no es válida.',
    invalidTime: 'La hora no es válida.',
    incompleteTimes: 'Completá las dos horas o dejá ambas vacías para días completos.',
    endNotAfterStart: 'El fin tiene que ser posterior al inicio.',
    tooLong: 'La ausencia no puede durar más de 365 días.',
    tooFarAhead: 'La fecha de inicio está demasiado lejos. Revisá el año.',
    tooFarBack: 'La fecha de inicio es demasiado antigua. Revisá el año.',
    reasonTooLong: 'El motivo no puede superar los 255 caracteres.',
    limitReached: 'Llegaste al máximo de ausencias para este barbero.',
    infrastructureError:
      'No pudimos guardar los cambios. Revisá la lista de ausencias antes de reintentar, por las dudas de que se haya guardado.',
  },
  businessProfile: {
    nav: 'Mi perfil',
    heading: 'Mi perfil público',
    intro:
      'Esto es lo que ven tus clientes cuando abren tu link. El nombre y la dirección del link son obligatorios; el resto es opcional.',

    businessNameLabel: 'Nombre de la barbería',
    bioLabel: 'Descripción (opcional)',
    bioHint: 'Contá en pocas líneas qué hace especial a tu barbería.',

    photoLabel: 'Foto de perfil',
    coverLabel: 'Imagen de portada',
    imageChoose: 'Elegir imagen',
    imageReplace: 'Cambiar',
    imageRemove: 'Quitar',
    imageEmpty: 'Sin imagen',
    imageHint: 'JPG, PNG o WEBP. La achicamos automáticamente antes de subirla.',
    // Two things the owner cannot discover on their own and would rather know
    // before uploading than after.
    imagePrivacyNote:
      'Al subirla le quitamos los datos ocultos, incluida la ubicación donde fue tomada. Tené en cuenta que una imagen publicada puede seguir viéndose un rato aunque la cambies.',
    imageProcessing: 'Preparando la imagen…',
    imageUndecodable: 'No pudimos leer ese archivo como imagen. Probá con otra.',
    imageUnsupportedType: 'El archivo tiene que ser JPG, PNG o WEBP.',
    imageTooLarge: 'La imagen es demasiado grande.',
    imageUploadFailed: 'No pudimos subir la imagen. Intentá de nuevo.',
    // Distinct from the one above: nothing was attempted. The form said
    // "reemplazar" and no file came with it, so telling the owner the upload
    // failed would describe something that never happened.
    imageReselect: 'Volvé a elegir la imagen y guardá de nuevo.',

    slugLabel: 'Dirección de tu link',
    slugHint:
      'Solo minúsculas, números y guiones. Se arma sola a partir del nombre, pero podés cambiarla.',
    slugRequired: 'Ingresá la dirección de tu link.',
    slugTooShort: 'La dirección tiene que tener al menos 3 caracteres.',
    // Shows the normalized value: the owner may have typed "Barbería Don Juan"
    // and an error naming a string they never wrote reads as a bug.
    slugTaken: (slug: string) => `La dirección "${slug}" ya está en uso. Probá con otra.`,
    slugChangeWarning:
      'Si cambiás la dirección, los links que ya compartiste dejan de funcionar. No hay forma de saber quién los tiene guardados.',

    socialHeading: 'Redes y contactos',
    socialIntro: 'Podés agregar un link por red.',
    socialEmpty: 'Todavía no agregaste ninguna red.',
    socialAdd: 'Agregar red',
    socialRemove: 'Quitar',
    socialPlatformLabel: 'Red',
    socialUrlLabel: 'Link',
    socialIncomplete: 'Completá la red y el link, o dejá la fila vacía.',
    socialUnknownPlatform: 'Elegí una red de la lista.',
    socialDuplicatePlatform: 'Ya agregaste esa red más arriba.',
    socialInvalidUrl: 'El link no es válido. Tiene que empezar con http:// o https://.',
    socialInvalidProtocol: 'El link tiene que empezar con http:// o https://.',
    socialUrlTooLong: 'El link es demasiado largo.',
    socialTooMany: 'Podés agregar como máximo un link por red.',

    linkHeading: 'Tu link para compartir',
    linkCopy: 'Copiar',
    linkCopied: '¡Copiado!',
    linkCopyFailed: 'No pudimos copiarlo. Seleccionalo y copialo a mano.',
    // `linkNotPublishedYet` lived here until B1. It said the link was not
    // reachable yet, which was true while `/b/**` redirected to `/login` — and
    // became false the moment the public page shipped. Removed rather than
    // reworded: there is nothing left to disclose.
    linkBeforeSave: 'Guardá el perfil para obtener tu link.',

    nameRequired: 'Ingresá el nombre de tu barbería.',
    nameLength: 'El nombre tiene que tener entre 2 y 120 caracteres.',
    bioTooLong: 'La descripción no puede superar los 1000 caracteres.',

    save: 'Guardar cambios',
    saving: 'Guardando…',
    // An upload through a Server Action cannot report progress, so several
    // seconds on a mobile connection is indistinguishable from a frozen page
    // without this.
    savingHint: 'Estamos subiendo tus imágenes. No cierres esta pestaña.',
    saved: 'Listo, guardamos tu perfil.',
    alreadyExists: 'Tu perfil ya estaba guardado. Recargá la página y volvé a intentar.',
    infrastructureError:
      'No pudimos guardar los cambios. Revisá el perfil antes de reintentar, por las dudas de que se haya guardado.',
  },
  // The client's side of the product, deliberately sharing not one string with
  // `businessProfile` above (B1 design D18). Two audiences, two tones: the owner
  // is administering a business, the client arrived from a WhatsApp message.
  // Sharing strings means editing a message for one and silently changing what
  // the other reads.
  publicProfile: {
    // Used as the image alternative text, so it names the shop rather than
    // describing the file.
    coverAlt: (businessName: string) => `Portada de ${businessName}`,
    photoAlt: (businessName: string) => `Foto de ${businessName}`,
    socialHeading: 'Seguinos',
    // Six of these are brand names and are the same in every language; `WEBSITE`
    // is not — "Sitio web" is translatable copy, and it living in the component
    // was the one user-facing string outside this file.
    platforms: {
      INSTAGRAM: 'Instagram',
      FACEBOOK: 'Facebook',
      TIKTOK: 'TikTok',
      WHATSAPP: 'WhatsApp',
      X: 'X',
      YOUTUBE: 'YouTube',
      WEBSITE: 'Sitio web',
    },
    // The whole reason the page exists. Live as of B2 — but only when the shop
    // actually has something bookable; `bookUnavailable` is what the control
    // says otherwise, and it is no longer the ordinary case.
    book: 'Reservar',
    bookUnavailable: 'Esta barbería todavía no está tomando reservas online.',
    loading: 'Cargando…',
    /**
     * **It used to say "No encontramos esta barbería", and that was false half
     * the time.** This one boundary serves the whole public namespace — the
     * profile, the booking flow and the booking link — so it answers for a bad
     * slug *and* for a booking that resolved nothing. Measured in production:
     * a real slug with an unknown token rendered "the barbershop was not
     * found", and then advised the client to ask that same shop for a new link.
     *
     * N1 is what raised the stakes. The booking link now travels by email, gets
     * forwarded and gets truncated by mail clients, so it outlives the address
     * bar it used to be confined to — and a permanent link deserves a failure
     * that is true.
     *
     * **The subject is now the link, which is the one thing both cases share.**
     * Route-specific wording would be better and is not currently available:
     * nested `not-found` boundaries do not resolve in this app (T75), so this
     * file is the only one that answers.
     *
     * It still says nothing about the cause, and for two reasons that survive
     * unchanged: the system cannot tell a slug that never existed from one the
     * owner changed (T33), and a booking token that never existed must be
     * indistinguishable from one whose booking is gone, or this page becomes an
     * oracle for which bookings exist (B4).
     */
    notFoundHeading: 'No encontramos este link',
    notFoundBody:
      'Puede estar incompleto o haber cambiado. Escribile a la barbería para que te pase el link actualizado.',
    errorHeading: 'No pudimos cargar la página',
    errorBody: 'Puede ser un problema momentáneo. Probá de nuevo en un rato.',
    retry: 'Reintentar',
  },
  // The booking flow, a **sibling** of `publicProfile` rather than nested inside
  // it (B2). Both address the same person, but at different moments: one is
  // reading about a shop, the other is committing to an appointment. One key per
  // public surface is B1's rule, and the reason holds here — editing a heading
  // for the profile should not silently reword a step in a booking.
  booking: {
    heading: 'Reservar turno',
    // Step labels, used by the indicator and as the heading of each step.
    steps: {
      location: 'Sucursal',
      service: 'Servicio',
      barber: 'Barbero',
      date: 'Día',
      slot: 'Horario',
      datos: 'Tus datos',
    },
    stepPosition: (current: number, total: number) => `Paso ${current} de ${total}`,
    locationHeading: '¿En qué sucursal?',
    serviceHeading: '¿Qué te querés hacer?',
    barberHeading: '¿Con quién?',
    back: 'Volver',
    change: 'Cambiar',
    summaryHeading: 'Tu reserva',
    // Duration is shown alongside the price so the client can judge the whole
    // commitment, not just its cost.
    duration: (minutes: number) => `${minutes} min`,
    price: (amount: string) => `$${amount}`,
    barberAvatarAlt: (displayName: string) => `Foto de ${displayName}`,
    loading: 'Cargando…',
    // Four empty states, deliberately distinct. None says *why* — deactivated,
    // never created and merely unassigned are indistinguishable to the client,
    // who cannot act on the difference, and the owner never agreed to publish it.
    emptyShop: 'Esta barbería todavía no está tomando reservas online.',
    emptyShopHelp: 'Escribile por sus redes para coordinar un turno.',
    emptyServices: 'Esta sucursal no tiene servicios disponibles en este momento.',
    emptyServicesHelp: 'Probá con otra sucursal.',
    emptyBarbers: 'No hay barberos disponibles para este servicio en esta sucursal.',
    emptyBarbersHelp: 'Probá con otro servicio.',
    // Shown when a shared link outlived the catalogue it was built from. Says
    // what happened and what still works, and nothing about the cause.
    staleLocation: 'La sucursal que habías elegido ya no está disponible. Elegí otra.',
    staleService: 'El servicio que habías elegido ya no está disponible en esta sucursal.',
    staleBarber: 'El barbero que habías elegido ya no está disponible. Elegí otro.',
    // A link shared on WhatsApp outlives the calendar faster than it outlives
    // the catalogue: a date that was bookable last week is in the past today.
    // Neither notice says why — "ya pasó", "está fuera de rango" and "no existe"
    // are one thing to the client, who simply needs to pick again.
    staleDate: 'El día que habías elegido ya no está disponible. Elegí otro.',
    staleSlot: 'Ese horario ya no está disponible. Elegí otro.',

    dateHeading: '¿Qué día?',
    slotHeading: '¿A qué hora?',
    // The strip marks a day the barber does not work rather than hiding it, so
    // the client sees that Sundays are closed instead of wondering why a date
    // is missing.
    dayUnavailable: (label: string) => `${label} (no atiende)`,
    // Grouping is what makes a five-minute grid scannable: a 9-to-18 day with a
    // 30-minute service is 103 starts, and a flat column of 103 is a scroll with
    // no landmarks (design D11).
    daypartMorning: 'Mañana',
    daypartAfternoon: 'Tarde',
    daypartEvening: 'Noche',
    // Four availability empty states. Like the catalogue ones, none discloses
    // whether a booking, an absence or a closed day is responsible — publishing
    // that would hand an anonymous visitor the barber's agenda.
    emptyDay: 'No quedan turnos disponibles para este día.',
    emptyDayHelp: 'Probá con otro día.',
    emptyToday: 'Ya no quedan turnos para hoy.',
    emptyTodayHelp: 'Probá con otro día.',
    emptyHorizon: 'Este barbero no tiene turnos disponibles por ahora.',
    emptyHorizonHelp: 'Probá con otro barbero.',
    // The list is a snapshot and nothing is held until the client submits their
    // details. The copy must not imply otherwise: two clients can be looking at
    // this time.
    slotNotHeld: 'Todavía no reservamos este horario.',

    // ---- B4: the client-details step ----
    datosHeading: '¿Con quién reservamos?',
    // The deposit is shown above the fields: the client is about to hand over
    // contact details, and the amount they will owe is what they consent to.
    depositLabel: 'Seña para confirmar',
    depositHelp: 'Se paga en el siguiente paso para asegurar el turno.',
    nameLabel: 'Nombre y apellido',
    emailLabel: 'Email',
    emailHelp: 'Te mandamos la confirmación acá.',
    phoneLabel: 'Teléfono',
    phoneHelp: 'Por si la barbería necesita contactarte.',
    submit: 'Reservar turno',
    submitting: 'Reservando…',

    // Field-level rejections. Each names its own mistake — "datos inválidos"
    // over three fields tells the client nothing they can act on.
    nameRequired: 'Escribí tu nombre y apellido.',
    nameTooShort: 'Escribí tu nombre completo.',
    nameTooLong: 'Ese nombre es demasiado largo.',
    emailRequired: 'Escribí tu email.',
    emailInvalid: 'Revisá el email: parece que falta algo.',
    emailTooLong: 'Ese email es demasiado largo.',
    phoneRequired: 'Escribí tu teléfono.',
    phoneInvalid: 'Revisá el teléfono. Por ejemplo: 11 5555-4444.',

    // Form-level outcomes. None discloses a cause: a taken slot, an absence and
    // a narrowed schedule are one thing to the client, who simply picks again.
    bookingFailed: 'No pudimos reservar el turno. Probá de nuevo en un momento.',
    // The shop cannot charge a deposit yet. It never says which half of the
    // owner's payment setup is missing — the owner did not agree to publish it
    // and the client cannot act on the difference.
    notTakingBookings: 'Esta barbería todavía no está tomando reservas online.',
    notTakingBookingsHelp: 'Escribile por sus redes para coordinar un turno.',
    // Two different refusals that used to share one string, which read wrong
    // for both. The throttle is "you are going too fast"; the hold cap is "you
    // already have several turns waiting to be paid" — and only the second
    // tells the client something they can act on.
    tooManyRequests: 'Esperá un momento antes de volver a intentar.',
    tooManyHolds: 'Ya tenés varias reservas esperando el pago.',
    tooManyHoldsHelp: 'Completá el pago de alguna antes de reservar otra.',

    // The JSON envelope's messages. Spanish like everything else the client
    // can see: a hydrated browser and a script both reach this endpoint, and
    // the flow speaks one language.
    apiInvalidRequest: 'Solicitud inválida.',
    apiValidationFailed: 'Revisá los datos ingresados.',
    apiBookingCreated: 'Turno reservado.',

    /**
     * The booking link resolved nothing.
     *
     * **Its own message, because the shared one told a lie.** Until this
     * existed the booking route fell through to the public namespace's
     * not-found — "No encontramos esta barbería" — so a client whose link was
     * mistyped, truncated by a mail client, or whose booking had been removed
     * was told the *shop* did not exist. It then advised them to ask that shop
     * for a new link. N1 made it matter: the link now lives in inboxes and gets
     * forwarded, so it outlives the address bar it used to be confined to.
     *
     * **It does not say why, and that is the same rule the shop-level page
     * follows.** A token that never existed and one whose booking is gone must
     * be indistinguishable from outside, or this page becomes an oracle for
     * which bookings exist (B4). Naming both possibilities without asserting
     * either is what keeps it honest and useless to a stranger.
     */
    linkNotFoundHeading: 'No encontramos esta reserva',
    linkNotFoundBody:
      'El link puede estar incompleto o el turno puede haber sido dado de baja. Escribile a la barbería para que te confirme cómo quedó.',

    // ---- B4: the hold confirmation page ----
    holdHeading: 'Te guardamos el turno',
    holdIntro: 'Reservamos este horario a tu nombre mientras completás el pago.',
    holdExpiresIn: (minutes: number) =>
      minutes === 1 ? 'Vence en 1 minuto.' : `Vence en ${minutes} minutos.`,
    holdExpired: 'La reserva venció y el horario volvió a estar disponible.',
    holdExpiredHelp: 'Podés elegir otro horario cuando quieras.',
    holdBookingFor: 'Turno de',

    // ---- B5: paying the deposit with Mercado Pago ----
    payDeposit: 'Pagar seña con Mercado Pago',
    payDepositSubmitting: 'Te llevamos a Mercado Pago…',
    payDepositHelp: 'Vas a completar el pago en el sitio de Mercado Pago.',

    /** A checkout is already open. The same control, named for what it does. */
    resumePayment: 'Seguir con el pago',
    resumePaymentHelp: 'Ya empezaste a pagar esta seña. Podés retomarlo desde acá.',

    /**
     * Returned from Mercado Pago, notification not processed yet.
     *
     * **N1 made the refresh real, so the help text stopped lying in the other
     * direction.** B5 wrote this state with no spinner and an instruction to
     * reload by hand, because the page did not poll and implying otherwise
     * would leave someone staring at it. T62 then measured that this is what
     * nearly every client sees — the redirect beats the notification — so the
     * most important moment in the product ended by asking for a reload.
     *
     * There are now two help strings because there are two states: the page
     * refreshes itself a bounded number of times, and then it stops. The
     * spinner belongs only to the first; on the terminal one nothing further is
     * going to happen and a spinner would be the same lie B5 refused.
     */
    paymentConfirming: 'Estamos confirmando tu pago',
    paymentConfirmingHelp: 'Puede tardar unos segundos. Esta página se actualiza sola.',
    /** The terminal form, after the last attempt. B5's original sentence. */
    paymentConfirmingHelpExhausted:
      'Está tardando más de lo normal. Actualizá esta página en unos segundos para ver el estado.',

    paymentConfirmed: '¡Listo! Tu turno está confirmado',
    paymentConfirmedHelp: 'Te esperamos. Guardá este link por si necesitás cancelar.',

    /**
     * What happened to the confirmation email (N1).
     *
     * Three variants and not two, because "we have not recorded it yet" and "it
     * failed" are different facts and only one of them is worth alarming
     * somebody with. The page must never claim a message that was not sent: in
     * the failed case the on-screen link stops being a convenience and becomes
     * the client's only copy, which is the whole reason the third string is
     * more emphatic than the first.
     */
    paymentConfirmedEmailSent: 'Te mandamos la confirmación a tu email.',
    paymentConfirmedEmailFailed:
      'No pudimos mandarte el mail de confirmación. Guardá este link: es tu única copia del turno.',

    /**
     * The shop ended the appointment (C2).
     *
     * **Never "venció".** Until C2 a cancelled booking fell through to the
     * lapsed-hold copy and told its client the reservation had run out of time,
     * when in fact somebody decided. The distinction is the entire reason this
     * product has `CANCELLED` and `EXPIRED` as separate statuses, and it is the
     * difference between "you were too slow" and "we cancelled on you".
     *
     * It apologises, because this is the one state on this page the shop caused
     * deliberately. It does not invent a reason — the product does not capture
     * one — and it does not promise a refund it cannot perform.
     */
    bookingCancelledByShop: 'La barbería canceló tu turno',
    bookingCancelledByShopHelp:
      'Lamentamos el inconveniente. El horario quedó libre, así que podés reservar otro cuando quieras.',
    /**
     * Added only when a deposit was actually approved. Same honesty as the
     * slot-lost state: the money moved, and this system does not move it back.
     */
    bookingCancelledDepositNote:
      'Tu seña no se devuelve por este sistema. Escribile a la barbería para coordinarla.',

    /**
     * The client cancelled it themselves (C1).
     *
     * **A receipt, not an apology.** The shop-cancelled copy above says sorry
     * because the shop caused it; saying sorry here would be the product
     * apologising to somebody for their own decision. It confirms what was
     * done, states that the slot is free, and invites them back — which is the
     * shop's interest as much as theirs.
     */
    bookingCancelledByClient: 'Cancelaste tu turno',
    bookingCancelledByClientHelp:
      'Listo, el horario quedó libre. Cuando quieras volver, reservá de nuevo desde el link de la barbería.',

    /**
     * The cancellation control, and the confirmation standing in front of it
     * (C1).
     *
     * **Two steps, because the token lives in an unverified mailbox** — the
     * constraint `tech-debt.md` T69 places on this story. The link that opens
     * this panel is a `GET` that writes nothing, so a scanner or a preview bot
     * reaches a page and not a cancelled appointment.
     */
    cancelBookingCta: 'Cancelar mi turno',
    cancelConfirmHeading: '¿Querés cancelar este turno?',
    cancelConfirmSlot: 'El horario queda libre en el momento y lo puede tomar otra persona.',
    cancelConfirmFinal: 'No se puede deshacer.',
    /**
     * Only when a deposit was actually approved. **The one surface that says it
     * while the decision is still reversible** — the cancelled page and the
     * owner's copy both say it afterwards, which is too late to be a choice.
     */
    cancelConfirmDeposit:
      'Ya pagaste la seña: no se devuelve por este sistema y la tenés que coordinar con la barbería.',
    /**
     * Only when a payment attempt is live. Cancelling does not close an open
     * Mercado Pago checkout — that would need the shop's credentials on this
     * path, which the payment story forbids — so the client is told instead.
     */
    cancelConfirmOpenPayment:
      'Si ya empezaste a pagar, no completes el pago: el turno se cancela igual. Y si ya transferiste, escribile a la barbería.',
    cancelConfirmSubmit: 'Sí, cancelar el turno',
    cancelConfirmBack: 'No, volver',

    /**
     * The two refusals, and they are two because the client acts on them
     * differently.
     *
     * **Neither is rendered when the booking is actually cancelled.** A second
     * submission, a lost response after a commit and a browser retry all reach
     * this page with a refusal code over a booking that is cancelled — and
     * "no pudimos cancelar" under a heading that says the turn is cancelled is
     * the product contradicting itself in two adjacent sentences.
     */
    cancelRefusedStarted:
      'No pudimos cancelarlo: el turno ya había empezado. Escribile a la barbería.',
    cancelRefusedMoved:
      'No pudimos cancelar el turno. El estado que ves arriba es el actual.',

    /**
     * The one state where the client is deliberately not offered the control.
     *
     * Without this sentence the absence reads as a bug. Their comprobante is
     * waiting for a human, and a cancellation would take it out of the only
     * queue anybody looks at — with the money already transferred.
     */
    receiptUnderReviewCancelHelp:
      'Si necesitás cancelar, escribile a la barbería: tu comprobante todavía está esperando respuesta.',

    /**
     * Cancelled, with nothing recorded about who did it.
     *
     * Every booking cancelled before C2 is one of these. Attributing the
     * decision to the shop would be inventing a fact, so this form states what
     * is known and nothing more.
     */
    bookingCancelled: 'Este turno fue cancelado',
    bookingCancelledHelp: 'El horario quedó libre. Podés reservar otro cuando quieras.',

    paymentRejected: 'El pago fue rechazado',
    paymentRejectedHelp: 'Podés intentar de nuevo con otro medio de pago.',
    /** How long is left, because that decides whether retrying is worth it. */
    paymentRejectedTimeLeft: (minutes: number) =>
      minutes === 1
        ? 'Te queda 1 minuto para completar el pago.'
        : `Te quedan ${minutes} minutos para completar el pago.`,

    /**
     * Paid, and the slot was gone. The one state on this page that owes an
     * explanation instead of an instruction — and it never pretends the money
     * did not move.
     */
    paymentPaidSlotLost: 'Recibimos tu pago, pero el horario ya no estaba disponible',
    paymentPaidSlotLostHelp:
      'Tu pago se acreditó y el turno no pudo confirmarse. La barbería se va a comunicar con vos para devolverte la seña o reprogramar.',

    /**
     * The shop cannot charge. Never phrased as the client's payment failing:
     * this is the owner's configuration, and blaming the person who tried to
     * pay for it would be both wrong and unhelpful.
     */
    paymentsUnavailable: 'No podemos procesar pagos en este momento',
    paymentsUnavailableHelp:
      'Es un problema de la barbería, no tuyo. Escribiles para coordinar la seña y no pierdas tu turno.',

    // ---- B6: the bank transfer deposit ----

    /** The two methods, side by side when both are configured. */
    payWithMercadoPago: 'Pagar con Mercado Pago',
    payWithTransfer: 'Pagar por transferencia',
    payWithTransferHelp: 'Vas a ver el CBU y después subís el comprobante.',

    /**
     * The destination, disclosed only after the client commits — which is also
     * what extends the hold. A CBU shown during a window about to lapse is how
     * somebody transfers real money into a turn they have already lost.
     */
    transferHeading: 'Transferí la seña',
    transferIntro: 'Hacé la transferencia y después subí el comprobante acá mismo.',
    transferDestinationHeading: 'Datos de la cuenta',
    transferCbuLabel: 'CBU / CVU',
    transferAliasLabel: 'Alias',
    transferHolderLabel: 'Titular',
    transferAmountLabel: 'Importe exacto a transferir',
    transferCopy: 'Copiar',
    transferCopied: 'Copiado',

    /**
     * Above the account number, never after it. Once the deadline passes there
     * is no gateway to ask whether the money moved, so the only protection is
     * that the client reads this **before** they transfer.
     */
    transferDeadlineWarning: (minutes: number) =>
      minutes === 1
        ? 'Te queda 1 minuto. Si transferís después de ese plazo, el turno puede perderse y la devolución hay que coordinarla con la barbería.'
        : `Te quedan ${minutes} minutos. Si transferís después de ese plazo, el turno puede perderse y la devolución hay que coordinarla con la barbería.`,

    receiptHeading: 'Subí el comprobante',
    receiptHelp: 'Aceptamos JPG, PNG o PDF, hasta 10 MB.',
    receiptField: 'Comprobante de la transferencia',
    receiptSubmit: 'Enviar comprobante',
    receiptSubmitting: 'Enviando…',
    receiptReplace: 'Subir otro comprobante',

    /** Under review. Terminal for the client: nothing left for them to do. */
    receiptUnderReview: 'Recibimos tu comprobante',
    receiptUnderReviewHelp:
      'La barbería lo va a revisar y confirmar tu turno. El horario queda reservado mientras tanto.',

    receiptRejected: 'La barbería no aprobó el comprobante',
    receiptRejectedHelp:
      'El turno quedó liberado. Escribiles si creés que hubo un error, o reservá de nuevo.',

    /**
     * Each refusal names its own cause, because each has a different next move.
     * A single "no se pudo subir" would tell a client with a 12 MB PDF and a
     * client with a HEIC photo the same useless thing.
     */
    receiptInvalid: 'Ese archivo no es un comprobante que podamos leer',
    receiptInvalidHelp:
      'Tiene que ser una imagen JPG o PNG, o un PDF. Si sacaste la foto con un iPhone, probá compartirla como JPG.',
    receiptTooLarge: 'El archivo es demasiado grande',
    receiptTooLargeHelp: 'El límite es 10 MB. Probá con una foto de menor resolución.',
    receiptTooMany: 'Ya subiste varios comprobantes para este turno',
    receiptTooManyHelp: 'Esperá a que la barbería revise el último que enviaste.',

    /** The shop has a destination that a client cannot safely use, or none. */
    transferUnavailable: 'Esta barbería no está recibiendo transferencias',
    transferUnavailableHelp: 'Probá con otro medio de pago o escribiles para coordinar.',

    /**
     * A Mercado Pago checkout is already open. Its own message because the
     * client can act on it — by finishing the one they started.
     */
    methodInUse: 'Ya tenés un pago de Mercado Pago en curso',
    methodInUseHelp: 'Completá ese pago, o esperá a que venza para elegir otro medio.',

    /**
     * The transfer arrived after the slot was gone. Distinct from a plain
     * expiry, because this one may mean money moved and nothing here knows it.
     */
    transferSlotLost: 'El horario ya no estaba disponible',
    transferSlotLostHelp:
      'No pudimos guardar tu comprobante para este turno. Si ya transferiste, escribile a la barbería para coordinar la devolución o un nuevo horario.',
  },
  transfer: {
    nav: 'Transferencia',
    heading: 'Datos para transferencia',
    intro:
      'Estos son los datos que ven tus clientes cuando eligen pagar la seña por transferencia.',
    formHeading: 'Cuenta de destino',
    currentHeading: 'Datos guardados',
    emptyState: 'Todavía no cargaste datos para recibir transferencias.',
    cbuLabel: 'CBU o CVU (opcional si cargás un alias)',
    cbuHelp: 'Son 22 números. Podés pegarlo con espacios o guiones.',
    aliasLabel: 'Alias (opcional si cargás un CBU)',
    aliasHelp: 'Entre 6 y 20 caracteres. Se guarda en minúscula.',
    holderLabel: 'Titular de la cuenta',
    holderHelp: 'El nombre que tu cliente va a ver al transferir.',
    submit: 'Guardar',
    submitting: 'Guardando…',
    saved: 'Datos guardados.',

    // Each rejection names its own mistake. Telling an owner who mistyped one
    // digit that their CBU is "inválido" explains the wrong thing.
    cbuInvalidLength: 'El CBU o CVU tiene que tener exactamente 22 números.',
    cbuInvalidChars: 'El CBU o CVU solo puede tener números.',
    cbuInvalidChecksum:
      'Ese CBU o CVU no es válido; revisá si se te escapó algún número. Fijate que no quede ningún dígito cambiado de lugar.',
    aliasInvalidLength: 'El alias tiene que tener entre 6 y 20 caracteres.',
    aliasInvalidChars:
      'El alias solo puede tener letras, números, puntos y guiones, y no puede empezar ni terminar con punto o guion.',
    holderRequired: 'Cargá el nombre del titular de la cuenta.',
    holderInvalidLength: 'El nombre del titular tiene que tener entre 2 y 120 caracteres.',
    holderInvalidChars:
      'El nombre del titular solo puede tener letras, espacios, apóstrofes, puntos y guiones.',
    noDestination: 'Cargá un CBU/CVU o un alias para poder recibir transferencias.',

    // The confirmation step (design D14). The alias namespace has no check
    // digit, so this is the only defence against a valid alias that belongs to
    // somebody else.
    confirmHeading: 'Confirmá la cuenta de destino',
    confirmIntro:
      'Revisá que sea exactamente tu cuenta. A partir de ahora, las señas de tus clientes van a ir acá.',
    confirmClearIntro:
      'Vas a borrar tus datos de transferencia. Tus clientes no van a poder pagar la seña por transferencia.',
    confirmCbuLabel: 'CBU o CVU',
    confirmAliasLabel: 'Alias',
    confirmHolderLabel: 'Titular',
    confirmNone: '—',
    confirmSubmit: 'Sí, es correcta',
    confirmCancel: 'Volver a editar',

    noMethodWarning:
      'No te queda ningún medio de pago configurado, así que no vas a poder recibir reservas. Cargá Mercado Pago o volvé a cargar tus datos de transferencia.',
    infrastructureError:
      'No pudimos guardar los cambios. Recargá la página para ver qué quedó guardado.',
  },
  mercadoPago: {
    nav: 'Mercado Pago',
    heading: 'Mercado Pago',
    intro:
      'Con estas credenciales tus clientes pagan la seña online y la reserva se confirma sola.',
    currentHeading: 'Estado',
    formHeading: 'Credenciales',

    // The four states of the page (design D12).
    emptyState:
      'Todavía no cargaste tus credenciales de Mercado Pago. Hasta que lo hagas, tus clientes no van a poder pagar online.',
    configured: 'Credenciales cargadas.',
    unreadableHeading: 'No podemos leer tus credenciales',
    unreadable:
      'Tus credenciales están guardadas pero no las podemos descifrar, así que no sirven para cobrar. Volvé a pegarlas para dejarlas andando.',

    // Only ever shown when the credential says `TEST-` outright. There is no
    // "Producción" label on purpose: nothing available to this app can prove a
    // credential is live, and the word reads as confirmation.
    environmentLabel: 'Entorno',
    environmentTest: 'Prueba',
    accountLabel: 'Cuenta de Mercado Pago',
    lastFourLabel: 'Access Token (últimos 4)',
    publicKeyLabel: 'Public Key',
    changedAtLabel: 'Última modificación',
    none: '—',

    accessTokenLabel: 'Access Token',
    accessTokenHelp: 'Se guarda cifrado y nunca se muestra. Dejalo vacío si no querés cambiarlo.',
    publicKeyHelp: 'Es el dato que ve el navegador de tu cliente. No es secreto.',
    submit: 'Guardar',
    submitting: 'Guardando…',
    // A verification may take seconds; the same label as a sub-second write
    // makes a working save look hung, which is what produces the second click.
    verifying: 'Verificando con Mercado Pago…',
    // A removal contacts nobody. Reusing the label above would have the button
    // claim it is talking to Mercado Pago while it is not — small, but it is
    // the same habit that produced two withdrawn decisions in this story.
    removing: 'Borrando…',
    saved: 'Credenciales guardadas.',
    savedUnverified:
      'Guardamos tus credenciales, pero no pudimos verificarlas con Mercado Pago en este momento. Si los pagos fallan, revisalas.',

    // One message per distinct mistake. Collapsing any two describes the wrong
    // problem to the owner.
    tokenInvalid:
      'Ese Access Token no tiene el formato que usa Mercado Pago. Copialo de nuevo desde "Tus integraciones".',
    publicKeyInvalid:
      'Esa Public Key no tiene el formato que usa Mercado Pago. Copiala de nuevo desde "Tus integraciones".',
    looksSwapped:
      'Parece que pegaste los datos al revés: lo que está en Access Token es una Public Key y viceversa. Cambialos de lugar.',
    environmentMismatch:
      'Una de las credenciales es de prueba y la otra no. Las dos tienen que ser del mismo par.',
    incompletePair:
      'Cargá el Access Token y la Public Key juntos. Con uno solo, el pago no funciona.',
    tokenRequiredForKeyChange:
      'Para cambiar la Public Key también tenés que pegar el Access Token: Mercado Pago los entrega en pareja y por separado no funcionan.',
    rejected:
      'Mercado Pago rechazó esas credenciales. No guardamos nada, así que las anteriores siguen funcionando. Fijate que estén completas y vigentes.',
    infrastructureError:
      'No pudimos guardar los cambios. Recargá la página y mirá "Última modificación" para ver qué quedó guardado.',
    // The token field empties on every rejection by design; without this the
    // owner reads it as the form losing their work.
    tokenClearedNotice:
      'Por seguridad no guardamos el Access Token en el formulario. Si tenés que corregir algo, pegalo de nuevo.',

    testCredentialsBanner:
      'Estás usando credenciales de prueba: los pagos no son reales y no vas a cobrar nada. Cambialas por las de producción antes de compartir tu enlace.',
    noMethodWarning:
      'No te queda ningún medio de pago configurado, así que no vas a poder recibir reservas. Cargá tus datos de transferencia o volvé a cargar Mercado Pago.',

    // The confirmation (designs D6 and D6a).
    confirmHeading: 'Confirmá la cuenta de Mercado Pago',
    // A removal involves no account, so it does not borrow the heading above.
    confirmRemoveHeading: 'Confirmá que querés borrar',
    confirmIntro:
      'Revisá que sea tu cuenta. A partir de ahora, las señas de tus clientes se cobran acá.',
    confirmRemoveIntro:
      'Vas a borrar tus credenciales de Mercado Pago. Tus clientes no van a poder pagar online.',
    confirmUnverified: 'No pudimos verificar estas credenciales con Mercado Pago en este momento.',
    confirmNewLabel: 'Credenciales nuevas',
    confirmStoredLabel: 'Credenciales actuales',
    confirmSubmit: 'Sí, es mi cuenta',
    confirmRemoveSubmit: 'Sí, borrar',
    confirmCancel: 'Volver a editar',

    remove: 'Borrar credenciales',
    removed: 'Credenciales borradas.',
  },
  receipts: {
    nav: 'Comprobantes',
    heading: 'Comprobantes por revisar',
    /**
     * The instruction, and the only honest framing of it. Nothing in this
     * product verifies that a transfer happened — a receipt image is trivially
     * fabricated and there is no bank integration — so the page says what the
     * owner has to do rather than implying the system already did it.
     */
    intro:
      'Verificá cada transferencia en tu banco antes de aprobar. El comprobante es una foto: no confirma que el dinero haya entrado.',
    emptyState: 'No hay comprobantes esperando revisión.',
    emptyStateHelp: 'Cuando un cliente pague por transferencia, su comprobante aparece acá.',

    appointmentLabel: 'Turno',
    clientLabel: 'Cliente',
    amountLabel: 'Importe que debería haber entrado',
    uploadedLabel: 'Comprobante subido',
    openFile: 'Ver comprobante',
    openFileHelp: 'Se descarga a tu dispositivo.',

    approve: 'Aprobar y confirmar turno',
    approving: 'Aprobando…',
    approved: 'Turno confirmado.',

    reject: 'Rechazar',
    rejecting: 'Rechazando…',
    rejected: 'Comprobante rechazado y turno liberado.',
    /**
     * Rejection is irreversible from here: it cancels the booking and frees the
     * slot. The confirmation says both halves, including the one this system
     * cannot do anything about.
     */
    rejectConfirm:
      '¿Rechazar este comprobante? El turno se cancela y el horario queda libre. Si el cliente ya transfirió, la devolución la tenés que coordinar vos.',

    /** The booking moved while the page was open. Not an error the owner caused. */
    noLongerPending: 'Ese turno ya no está esperando revisión. Actualizá la página.',
    notFound: 'No encontramos ese comprobante.',
    loadFailed: 'No pudimos cargar los comprobantes.',
    actionFailed: 'No pudimos completar la acción. Intentá de nuevo.',
    /** The signed link could not be produced. The row still renders. */
    fileUnavailable: 'No pudimos generar el enlace al comprobante.',
  },
  deposit: {
    nav: 'Seña',
    heading: 'Seña',
    intro:
      'La seña es lo que tu cliente paga para confirmar el turno. Podés cobrar un monto fijo o un porcentaje del precio del servicio.',
    formHeading: 'Cómo se calcula',
    currentHeading: 'Seña configurada',
    emptyState:
      'Todavía no configuraste la seña. Sin seña no podés recibir reservas, porque es lo que confirma cada turno.',

    typeLegend: 'Tipo de seña',
    typePercent: 'Porcentaje del precio',
    typeFixed: 'Monto fijo',
    percentLabel: 'Porcentaje',
    percentHelp: 'Un número entero del 1 al 100.',
    fixedLabel: 'Monto en pesos',
    fixedHelp: 'Escribilo sin puntos de miles. Por ejemplo: 2000 o 2000,50.',
    submit: 'Guardar',
    submitting: 'Guardando…',
    saved: 'Seña guardada.',

    // 100% is a legitimate model and is also what a slipped keystroke produces,
    // so it is named rather than accepted in silence.
    fullPrepaymentNotice:
      'Con 100%, tus clientes pagan el servicio completo por adelantado, no una seña.',

    // Each rejection names its own mistake. An owner who wrote 12,5 is told
    // percentages are whole numbers, not that their input tiene formato inválido.
    typeRequired: 'Elegí si la seña es un porcentaje o un monto fijo.',
    typeInvalid: 'Ese tipo de seña no existe. Elegí porcentaje o monto fijo.',
    valueRequired: 'Cargá el valor de la seña.',
    percentNotWhole: 'El porcentaje tiene que ser un número entero, sin decimales.',
    percentOutOfRange: 'El porcentaje tiene que estar entre 1 y 100.',
    percentInvalidFormat: 'El porcentaje solo puede tener números.',
    fixedOutOfRange: 'El monto de la seña tiene que ser mayor a cero.',
    fixedTooLarge: 'Ese monto es demasiado alto.',
    fixedInvalidFormat: 'El monto solo puede tener números y como mucho dos decimales.',
    fixedThousandsSeparator:
      'Escribí el monto sin puntos de miles. Por ejemplo, 8000,50 en lugar de 8.000,50.',
    fixedTooManyDecimals: 'El monto puede tener como mucho dos decimales.',

    // The confirmation step (design D6). A value off by a factor of ten passes
    // every format check and is obvious next to a real price.
    confirmHeading: 'Confirmá la nueva seña',
    confirmIntro:
      'Así queda la seña de cada uno de tus servicios. Revisá que sean los montos que querés cobrar.',
    confirmStoredLabel: 'Seña actual',
    confirmNewLabel: 'Seña nueva',
    confirmServiceColumn: 'Servicio',
    confirmPriceColumn: 'Precio',
    confirmDepositColumn: 'Seña',
    confirmNoServices:
      'Todavía no tenés servicios cargados, así que no podemos mostrarte cómo queda. Vas a poder revisarlo cuando cargues el primero.',
    confirmNone: '—',
    confirmSubmit: 'Sí, guardar',
    confirmCancel: 'Volver a editar',

    confirmRemoveHeading: 'Confirmá que querés quitar la seña',
    confirmRemoveIntro:
      'Si quitás la seña, no vas a poder recibir reservas hasta que configures una nueva.',
    confirmRemoveSubmit: 'Sí, quitar',
    remove: 'Quitar seña',
    removed: 'Seña quitada.',

    // Reported, never blocking. The cap in the calculation is what actually
    // protects the client; this exists so the owner learns about the mismatch
    // when they can still act on it.
    exceedsPricesWarning:
      'La seña es más alta que el precio de estos servicios, así que en ellos tu cliente va a pagar el precio completo:',
    belowMinimumWarning:
      'En estos servicios la seña queda por debajo del mínimo que se puede cobrar, así que se va a cobrar el mínimo:',

    readinessHeading: 'Estado de tu negocio',
    readinessReady: 'Ya podés recibir reservas.',
    readinessNotReady: 'Todavía no podés recibir reservas.',
    readinessMissingPaymentMethod:
      'Falta configurar un medio de pago: Mercado Pago o transferencia.',
    readinessMissingDeposit: 'Falta configurar la seña.',
    readinessHasPaymentMethod: 'Medio de pago configurado.',
    readinessHasDeposit: 'Seña configurada.',

    noMethodWarning:
      'No tenés ningún medio de pago configurado, así que todavía no vas a poder recibir reservas. Cargá Mercado Pago o tus datos de transferencia.',
    infrastructureError:
      'No pudimos guardar los cambios. Recargá la página para ver qué quedó guardado.',
  },
  dashboard: {
    nav: 'Inicio',
    heading: 'Inicio',

    /**
     * Every label names what its figure counts.
     *
     * This is the only thing that makes a number checkable by the person
     * reading it, and it is why none of these is the obvious short word.
     * "Turnos totales" would be a count of checkout attempts; "Ingresos" would
     * be read as turnover and be wrong by the whole service price.
     */
    confirmedToday: 'Turnos confirmados hoy',
    heldToday: (count: number) =>
      count === 1 ? '1 reserva sin confirmar' : `${count} reservas sin confirmar`,
    heldTodayHelp: 'Están reservando el horario pero todavía no pagaron la seña.',
    cancelledToday: 'Cancelaciones de hoy',
    confirmedAllTime: 'Turnos confirmados (histórico)',
    pendingReceipts: 'Comprobantes por revisar',
    monthIncome: 'Señas cobradas este mes',
    /**
     * The qualifier, and it is not fine print. Two facts, and D5 added the
     * second.
     *
     * **What it is:** this product never records the balance the client pays in
     * the chair, so an owner reading this figure as their month's takings would
     * be reading a number wrong by the whole service price. Same rule the
     * receipt queue follows: a surface must not imply a fact the system does not
     * have.
     *
     * **When it is:** this counter is bounded on `Payment.approvedAt` — money
     * that *arrived* this month. The statistics page reports deposits belonging
     * to a period's *appointments*, bounded on `Booking.startTime`. A deposit
     * approved on 25 August for a 3 September appointment is in this month here
     * and in next month there. Both are right, they will not agree, and before
     * D5 there was nothing to disagree with — which is why the sentence grew.
     */
    monthIncomeHelp:
      'Solo las señas aprobadas durante este mes. No incluye lo que cada cliente paga en el local.',

    /**
     * A read that failed. Deliberately not a zero and deliberately not an
     * alarm — a figure that could not load is not an incident, but it is also
     * not a fact about the business.
     */
    countersFailed: 'No pudimos cargar los indicadores. Actualizá la página.',
    recentFailed: 'No pudimos cargar las reservas recientes.',

    // ---- C2: the owner cancels a booking ----

    cancel: 'Cancelar turno',
    cancelling: 'Cancelando…',
    /** Named, so a row's control says which booking it ends. */
    cancelLabel: (clientName: string) => `Cancelar el turno de ${clientName}`,

    /**
     * The confirmation, and it names the three things this system cannot undo.
     *
     * The same shape the receipt rejection uses: destructive, irreversible from
     * the owner's side, and honest about the part the product does not perform.
     * The slot is released **immediately** and may be taken while the owner is
     * still looking at the page, which is the detail an owner would otherwise
     * discover by trying to undo.
     */
    cancelConfirm:
      '¿Cancelar este turno? El horario queda libre al instante y otra persona puede tomarlo. No se puede deshacer, y si el cliente ya pagó la seña, la devolución la coordinás vos.',

    /**
     * **It confirms the cancellation and claims nothing about the client.**
     *
     * The rule N1 established: telling an owner a client has been informed when
     * they have not removes the owner's reason to phone them, which is the only
     * recovery this product offers for a message that did not arrive.
     */
    cancelled: 'Turno cancelado. El horario quedó libre.',

    /**
     * The booking moved between the page render and the submission — confirmed
     * by a notification, swept by the expiry job, or simply cancelled already
     * in another tab. Not an error: the guard doing its job is the system
     * working, and the owner needs the page refreshed rather than an apology.
     */
    cancelNotPossible: 'Este turno ya no se puede cancelar. Actualizá la página para ver su estado.',

    /**
     * A booking outside this owner's scope and one that never existed answer
     * identically, so this string covers both. A differential message would
     * make the dashboard an oracle for which bookings exist.
     */
    cancelNotFound: 'No encontramos ese turno.',
    cancelFailed: 'No pudimos cancelar el turno. Intentá de nuevo más tarde.',

    /**
     * Who ended a cancelled booking (C1).
     *
     * **This is the other half of the decision not to email the owner.** A
     * client can now cancel their own turn, so "Cancelaciones de hoy" sums two
     * different events and the status alone cannot separate them. No message is
     * sent, so the surface that replaces the message has to carry the fact.
     *
     * A booking with no recorded canceller renders neither line: every such row
     * predates the column being written, and inventing an actor would be
     * inventing a fact.
     */
    cancelledByOwner: 'Cancelado por vos',
    cancelledByClient: 'Cancelado por el cliente',

    recentHeading: 'Reservas recientes',
    recentEmpty: 'Todavía no recibiste reservas.',
    recentEmptyHelp: 'Compartí tu link de reservas para empezar a recibir turnos.',
    recentEmptyLink: 'Ver mi link en Perfil',
    /**
     * A filtered-empty state that looked like a global-empty state would read
     * as a broken dashboard, so it names the barber and offers the way back.
     */
    recentEmptyFiltered: (barber: string) => `${barber} todavía no tiene reservas.`,
    clearFilter: 'Ver todas',

    filterLabel: 'Filtrar por barbero',
    filterAll: 'Todos los barberos',
    filterSubmit: 'Filtrar',

    clientLabel: 'Cliente',
    depositLabel: 'Seña',

    /**
     * The five statuses, in the owner's words.
     *
     * `CANCELLED` and `EXPIRED` say different things on purpose: one is a
     * decision somebody made and the other is a deadline that passed, and this
     * list is the first surface in the product where an owner sees either.
     */
    status: {
      PENDING_PAYMENT: 'Esperando pago',
      PENDING_APPROVAL: 'Comprobante por revisar',
      CONFIRMED: 'Confirmado',
      CANCELLED: 'Cancelado',
      EXPIRED: 'Sin confirmar a tiempo',
    },
  },
  /**
   * The per-barber day calendar (D3).
   *
   * **"Libre" rather than "disponible" throughout, deliberately.** This page
   * shows free *time*, not bookable slots: a slot needs a service's duration and
   * a lead time, and no service is chosen here. Copy promising availability
   * would make the page state something it cannot know.
   */
  barberCalendar: {
    manage: 'Calendario',
    manageLabel: (barberName: string) => `Ver el calendario de ${barberName}`,
    heading: (barberName: string) => `Calendario de ${barberName}`,
    // The heading when the read failed: the barber's name arrives with the day,
    // so a failure has no name to use and must not render "Calendario de ".
    headingUnknown: 'Calendario',
    previousDay: 'Día anterior',
    nextDay: 'Día siguiente',
    today: 'Hoy',
    pickDayLabel: 'Ir a un día',
    goToDay: 'Ir',
    pastDay: 'Día pasado',
    freeHeading: 'Tiempo libre',
    range: (from: string, to: string) => `${from} a ${to}`,
    // Not 'disponible': see the note above this namespace.
    noFreeTime: 'Sin tiempo libre en este día.',
    absence: 'Ausencia',
    // Four sentences rather than one range, because an absence can begin before
    // this day and end after it — and a chip showing only its wall-clock times
    // would say "10:00 a 18:00" about a day the barber is away for all of.
    absenceWholeDay: 'Todo el día',
    absenceUntil: (time: string) => `Hasta las ${time}`,
    absenceFrom: (time: string) => `Desde las ${time}`,
    appointmentsHeading: 'Turnos del día',
    // Two empty states that must never share copy. "Closed" and "open and
    // empty" are opposite facts, and one message for both sends the owner to
    // fix a schedule that is not broken.
    noSchedule: 'Este día el barbero no trabaja.',
    noScheduleHint: 'No tiene horario cargado para este día de la semana.',
    manageSchedule: 'Editar horarios',
    emptyDay: 'Sin turnos en este día.',
    // Only true of a day nothing else touches. An absence makes it false, and
    // on a day an absence covers entirely it directly contradicts the free-time
    // region below it — which is what the runtime pass caught.
    emptyDayHint: 'El horario está libre de punta a punta.',
    emptyDayAway: 'El barbero está ausente este día.',
    // The badge T29 exists for. It describes the appointment's relation to the
    // schedule as it stands now — it does not accuse anybody of an error.
    outsideHours: 'Fuera del horario laboral',
    outsideHoursHint: 'Quedó fuera del horario actual del barbero.',
    recordedHeading: (count: number) =>
      count === 1 ? '1 turno sin efecto' : `${count} turnos sin efecto`,
    recordedHelp: 'Cancelados o vencidos. No ocupan el horario.',
    cancelledByOwner: 'Cancelado por la barbería',
    cancelledByClient: 'Cancelado por el cliente',
    // No third string for a cancellation with no recorded actor. Every booking
    // cancelled before C2 gave the column a writer is one, and the row's own
    // presence label already reads "Cancelado" — a second line saying the same
    // word is noise, and any wording naming an actor would be invented.
    dayNavigation: 'Navegación de días',
    /**
     * How a booking appears on this day, in the owner's words.
     *
     * Deliberately not the dashboard's status labels: this page names a
     * *presence*, not a status. "Esperando pago" would be wrong for a hold that
     * has lapsed, and "Sin confirmar a tiempo" would be wrong for one still
     * live — and the two share a status.
     */
    presence: {
      confirmed: 'Confirmado',
      awaitingApproval: 'Comprobante por revisar',
      holding: 'Reservando (pago en curso)',
      lapsed: 'Sin confirmar a tiempo',
      cancelled: 'Cancelado',
    },
    // Zero and failure never render alike: an empty day here would be a false
    // statement about the barber's schedule.
    loadFailed: 'No pudimos cargar el calendario.',
    loadFailedHelp: 'Volvé a intentar en unos segundos.',
  },
  /**
   * The clients directory (D4).
   *
   * **The zero row never calls that person a customer.** A client record can
   * exist with no booking of any kind — the booking flow creates it before it
   * writes the booking, so a refused submission leaves one behind — and copy
   * that read "0 turnos" beside the word "cliente" would report a failed
   * checkout as business.
   */
  clients: {
    nav: 'Clientes',
    heading: 'Clientes',
    intro: 'Todas las personas que reservaron alguna vez en tu barbería.',
    columnName: 'Nombre',
    columnPhone: 'Teléfono',
    columnEmail: 'Email',
    columnBookings: 'Turnos',
    // Labelled, never a bare digit: two numbers share this cell and an
    // unlabelled pair cannot be told apart.
    confirmedCount: (count: number) => (count === 1 ? '1 turno cumplido' : `${count} turnos cumplidos`),
    inactiveCount: (count: number) =>
      count === 1 ? '1 cancelado o vencido' : `${count} cancelados o vencidos`,
    // The row that is neither a customer nor a canceller: a checkout that
    // reached the details step and never became a booking.
    noBookings: 'Sin turnos',
    noBookingsHint: 'Dejó sus datos pero nunca llegó a reservar.',
    callLabel: (name: string) => `Llamar a ${name}`,
    emailLabel: (name: string) => `Escribir a ${name}`,
    // Three states that must never share copy.
    empty: 'Todavía no reservó nadie.',
    emptyHint: 'Cuando alguien reserve desde tu enlace público, va a aparecer acá.',
    emptyLink: 'Ver mi perfil público',
    loadFailed: 'No pudimos cargar tus clientes.',
    loadFailedHelp: 'Volvé a intentar en unos segundos.',
    previousPage: 'Anterior',
    nextPage: 'Siguiente',
    pageStatus: (page: number, lastPage: number) => `Página ${page} de ${lastPage}`,
    totalStatus: (total: number) => (total === 1 ? '1 cliente' : `${total} clientes`),
  },
  statistics: {
    nav: 'Estadísticas',
    heading: 'Estadísticas',
    intro: 'Cómo viene tu negocio en el período que elijas.',

    /**
     * The range control. The labels are the six the brief asks for, and the
     * accessible name exists because a row of links with no heading is a list
     * of destinations rather than a control.
     */
    rangeLabel: 'Período',
    ranges: {
      hoy: 'Hoy',
      ayer: 'Ayer',
      semana: 'Esta semana',
      'semana-anterior': 'Semana pasada',
      mes: 'Este mes',
      'mes-anterior': 'Mes pasado',
    } as const,
    /**
     * The same six periods as an adverbial phrase, for sentences that mention
     * one rather than label it.
     *
     * **A second map rather than a preposition glued to the first**, and the
     * runtime pass is what found the difference. Composing `en ${label}` reads
     * correctly for two of the six and wrong for four: *"No hubo turnos **en
     * hoy**"*, *"en ayer"*, *"en semana pasada"*, *"en mes pasado"*. Spanish
     * takes no preposition before `hoy` and `ayer`, and needs the article
     * before `semana pasada` and `mes pasado`.
     *
     * No test could have caught it — the assertions compare the composed string
     * against itself, and both sides would have been equally wrong. It took
     * looking at the page.
     */
    rangesInPhrase: {
      hoy: 'hoy',
      ayer: 'ayer',
      semana: 'esta semana',
      'semana-anterior': 'la semana pasada',
      mes: 'este mes',
      'mes-anterior': 'el mes pasado',
    } as const,

    confirmedCount: 'Turnos confirmados',
    /**
     * Never a count of bookings. A row count is a count of checkout attempts,
     * and abandoned holds accumulate without bound relative to real business.
     */
    confirmedCountHelp: 'Turnos que llegaron a confirmarse en este período.',

    depositTotal: 'Señas de estos turnos',
    /**
     * The basis sentence D-1 requires, and it carries both halves.
     *
     * **What it is:** deposits, not turnover — the same rule the dashboard
     * home's card follows, for the same reason.
     *
     * **When it is:** these deposits belong to the *appointments* in this
     * period, whenever the money actually arrived. The home's counter answers
     * the opposite question. The two will not match, and an owner who cannot
     * see why has been shown two numbers that look like one.
     */
    depositTotalHelp:
      'Señas de los turnos de este período, sin importar cuándo se cobraron. No incluye lo que cada cliente paga en el local.',

    cancelledCount: 'Cancelaciones',
    /**
     * `EXPIRED` is never counted here, and the copy says so rather than leaving
     * an owner to wonder where the abandoned checkouts went.
     */
    cancelledCountHelp: 'No cuenta las reservas que vencieron sin pagar la seña.',
    /**
     * Shown only when non-zero. "Mis clientes cancelaron tres" and "yo les
     * cancelé tres" are opposite facts about un negocio.
     */
    cancelledByOwner: (count: number) =>
      count === 1 ? '1 la cancelaste vos' : `${count} las cancelaste vos`,
    cancelledByClient: (count: number) =>
      count === 1 ? '1 la canceló el cliente' : `${count} las cancelaron los clientes`,

    averageDeposit: 'Seña promedio por turno',
    averageDepositHelp: 'Las señas de este período divididas por sus turnos confirmados.',
    /**
     * The absent state, and it is not a zero. An average over no appointments
     * is neither an answer nor a failure, and `$ 0,00` would state that turnos
     * happened and no dejaron nada.
     */
    averageDepositAbsent: '—',
    averageDepositAbsentHelp: 'Sin turnos confirmados en este período.',

    uniqueClients: 'Clientes distintos',
    uniqueClientsHelp: 'Alguien con varios turnos en el período cuenta una vez.',

    /**
     * Three states that must never share copy.
     *
     * The first is a quiet period in a working shop and points at a wider one.
     * The second is a shop whose public link nobody has ever used and points at
     * the link. The third is a read that failed and states nothing about the
     * business at all.
     */
    emptyPeriod: (phrase: string) => `No hubo turnos ${phrase}.`,
    emptyPeriodHint: 'Probá con un período más largo.',
    emptyPeriodLink: 'Ver este mes',
    emptyShop: 'Todavía no reservó nadie.',
    emptyShopHint: 'Cuando alguien reserve desde tu enlace público, vas a ver los números acá.',
    emptyShopLink: 'Ver mi perfil público',
    loadFailed: 'No pudimos cargar tus estadísticas.',
    loadFailedHelp: 'Volvé a intentar en unos segundos.',

    // ---- D6: the two charts and the sixth figure ----

    /**
     * The income chart.
     *
     * The accessible name is a sentence rather than a label, because a chart is
     * an image to a screen reader and "Evolución de ingresos" names the picture
     * without saying what it shows. The period is interpolated so the name is
     * true of the chart actually drawn.
     */
    incomeChartHeading: 'Evolución de ingresos',
    incomeChartHelp: 'Señas de los turnos de cada día del período. No incluye lo que se paga en el local.',
    incomeChartHelpHourly:
      'Señas de los turnos de cada hora del día. No incluye lo que se paga en el local.',
    /**
     * **`que hubo` is load-bearing and was found by the test, not by reading.**
     * `rangesInPhrase` is shaped for *"No hubo turnos ___"*, so its members
     * carry no preposition: `hoy`, `esta semana`, `el mes pasado`. Dropping them
     * straight after a noun gives *"los turnos hoy"* and *"los turnos esta
     * semana"*. A verb before the phrase restores the grammar for all six
     * without needing a third map — the same defect D5's runtime pass found in
     * the empty-period sentence, caught this time by a test that spells the
     * expected sentence out instead of composing it the same way the code does.
     */
    incomeChartLabel: (phrase: string) =>
      `Gráfico de barras: señas cobradas por los turnos que hubo ${phrase}.`,
    /** The table is the chart's equivalent, not a debugging aid. */
    incomeChartTableCaption: 'Señas por período',
    incomeChartBucketColumn: 'Período',
    incomeChartAmountColumn: 'Señas',
    /**
     * The period had appointments and collected nothing. **An answer, not an
     * absence** — which is why it is not the empty state and the axis is still
     * drawn, at zero.
     */
    incomeChartAllZero: 'Hubo turnos, pero todavía no se cobró ninguna seña en este período.',

    /**
     * The payment-method split.
     *
     * `methodShare` states the amount and the count together because either one
     * alone describes the shop wrongly: three small transfers against one large
     * Mercado Pago payment is a different fact depending on whether the owner is
     * thinking about fees or about clients.
     */
    methodsChartHeading: 'Métodos de pago',
    methodsChartHelp: 'Cómo se repartieron las señas cobradas entre los dos medios de pago.',
    methodsChartLabel: 'Gráfico de proporción: reparto de las señas entre Mercado Pago y transferencia.',
    methodsChartTableCaption: 'Señas por método de pago',
    methodsChartMethodColumn: 'Medio de pago',
    methodsChartAmountColumn: 'Total',
    methodsChartCountColumn: 'Pagos',
    methods: {
      MERCADO_PAGO: 'Mercado Pago',
      BANK_TRANSFER: 'Transferencia',
    } as const,
    methodPaymentCount: (count: number) => (count === 1 ? '1 pago' : `${count} pagos`),
    /**
     * The degenerate case: one method, which is the permanent state of every
     * owner who configured only one. A share of a single part is not
     * information, so it is stated in words instead of drawn.
     */
    methodsChartSingle: (method: string, amount: string, count: string) =>
      `Todas las señas del período entraron por ${method}: ${amount} en ${count}.`,
    methodsChartEmpty: 'No se cobraron señas en este período.',

    /** The charts failed while the figures did not. Never a flat zero line. */
    chartsFailed: 'No pudimos cargar los gráficos.',
    chartsFailedHelp: 'Los números de arriba sí están actualizados. Actualizá la página.',

    /**
     * The sixth figure (T83), and the whole point of it is the second sentence.
     *
     * **It is bounded on the approval, not on the turno**, unlike every other
     * figure on this page. A deposit approved on 25 de agosto for a turno on
     * 3 de septiembre is in this figure's August and in the deposits card's
     * September. Both are right and they will not agree, so the copy says so —
     * an owner who discovers that on their own concludes one of the two is
     * broken.
     */
    cashCollected: 'Dinero cobrado',
    cashCollectedHelp:
      'Señas aprobadas durante el período, sin importar cuándo es el turno. Puede no coincidir con "Señas cobradas": esa cuenta los turnos del período, esta cuenta el dinero que entró.',

    // -----------------------------------------------------------------------
    // D7 — the two rankings and the hour-of-day distribution
    // -----------------------------------------------------------------------

    servicesChartHeading: 'Servicios más pedidos',
    /**
     * The basis, and the one thing an owner would otherwise get wrong: this is
     * demand, not revenue. A busy service can be the cheapest one.
     */
    servicesChartHelp:
      'Turnos confirmados de cada servicio en este período. Cuenta turnos, no plata.',
    servicesChartLabel: (phrase: string) =>
      `Gráfico de barras: servicios más pedidos ${phrase}.`,
    servicesChartTableCaption: 'Turnos por servicio',
    servicesChartNameColumn: 'Servicio',
    /**
     * A single service is stated rather than drawn: a ranking of one is not a
     * ranking, and a barra al 100 % no dice nada. It is the treatment the
     * payment-method split already gets when only one rail was used.
     */
    servicesChartSingle: (name: string, count: number) =>
      count === 1
        ? `Todos los turnos de este período fueron de ${name}: 1 turno.`
        : `Todos los turnos de este período fueron de ${name}: ${count} turnos.`,

    barbersChartHeading: 'Barberos con más turnos',
    barbersChartHelp: 'Turnos confirmados que atendió cada barbero en este período.',
    barbersChartLabel: (phrase: string) =>
      `Gráfico de barras: barberos con más turnos ${phrase}.`,
    barbersChartTableCaption: 'Turnos por barbero',
    barbersChartNameColumn: 'Barbero',
    barbersChartSingle: (name: string, count: number) =>
      count === 1
        ? `Todos los turnos de este período los atendió ${name}: 1 turno.`
        : `Todos los turnos de este período los atendió ${name}: ${count} turnos.`,

    /**
     * The count column both rankings share, and the aggregated row's name.
     *
     * The aggregate carries no service or barber name because it is not one of
     * them; it appears in the table and is never drawn as a bar, since a bar
     * whose height aggregates unlike things invites being read as one thing.
     */
    rankingCountColumn: 'Turnos',
    rankingShareColumn: 'Porcentaje',
    rankingOthers: 'Otros',

    hoursChartHeading: 'Turnos por hora del día',
    hoursChartHelp:
      'A qué hora arrancan los turnos confirmados del período, sumando todos sus días.',
    /**
     * A single day is one day's forma, not a tendencia — and the copy says
     * which period it is so the reading stays honest at every rango.
     */
    hoursChartHelpSingleDay:
      'A qué hora arrancaron los turnos confirmados de este día. Es un solo día: sirve para mirarlo, no para sacar conclusiones.',
    hoursChartLabel: (phrase: string) =>
      `Gráfico de barras: turnos por hora del día ${phrase}.`,
    hoursChartTableCaption: 'Turnos por hora',
    hoursChartHourColumn: 'Hora',
    hoursChartCountColumn: 'Turnos',
    /** The hour as it is labelled on the axis and in the table: `14 h`. */
    hoursChartHourLabel: (hour: number) => `${String(hour).padStart(2, '0')} h`,

    /**
     * The third failure state, and it is deliberately narrower than D6's.
     *
     * It says nothing about the figures or the charts, because whatever renders
     * it cannot know they succeeded — and copy that reassures an owner their
     * other numbers are current, printed beneath a card apologising for those
     * numbers, is the defect D6's adversarial pass found. The page decides when
     * this is shown at all.
     */
    breakdownsFailed: 'No pudimos cargar el desglose por servicio, barbero y horario.',
    breakdownsFailedHelp: 'Actualizá la página para volver a intentarlo.',
  },
  auth: {
    heading: 'Iniciar sesión',
    emailLabel: 'Email',
    passwordLabel: 'Contraseña',
    submit: 'Ingresar',
    submitting: 'Ingresando…',
    credentialsError: 'Email o contraseña incorrectos.',
    infrastructureError: 'No pudimos iniciar sesión. Intentá de nuevo más tarde.',
    logout: 'Cerrar sesión',
  },

  /**
   * The confirmation email (N1).
   *
   * **An email is user-facing copy that happens not to be rendered by React**,
   * so it lives here like every other Spanish string rather than inline in the
   * module that composes the message. The product's voice stays reviewable in
   * one file.
   *
   * These values are static and trusted. Everything interpolated into the
   * message — the client's name, the shop's, the branch's — is guest- or
   * owner-supplied and is escaped by the builder at the point of assembly, not
   * here: a template that pre-escaped its own literals would have to be undone
   * for the plain-text part.
   */
  email: {
    confirmation: {
      /** Composed from server-held values only. A header never carries guest text. */
      subject: (shopName: string, when: string) => `Tu turno en ${shopName} — ${when}`,
      greeting: (clientName: string) => `Hola ${clientName},`,
      heading: 'Tu turno está confirmado',
      intro: 'Ya está todo listo. Estos son los datos de tu turno:',

      whenLabel: 'Cuándo',
      whereLabel: 'Dónde',
      addressLabel: 'Dirección',
      barberLabel: 'Barbero',
      serviceLabel: 'Servicio',
      depositLabel: 'Seña pagada',
      balanceLabel: 'A pagar en el local',

      /**
       * The link block. The URL is also printed as text immediately below the
       * control, because a plain-text rendering or a forward is exactly where a
       * button-only link disappears.
       */
      /**
       * **It names cancelling now that the page can do it (C1).** The
       * sentence said only "ver" because that was all the page did; the same
       * words in the same inbox now understate a control one click away, and a
       * client who cannot come would go on writing to the shop instead of using
       * the link they were sent.
       *
       * It does not say the link cancels anything — following it renders a
       * page, and cancelling takes a further deliberate step. That distinction
       * is the whole of T69's mitigation and the wording must not blur it.
       */
      linkIntro: 'Guardá este link. Desde ahí podés ver o cancelar tu turno:',
      linkLabel: 'Ver mi turno',

      /**
       * What the message says when no public origin is configured and there is
       * therefore no link to give. It never apologises for a URL the reader
       * cannot see — it tells them the one thing they can act on.
       */
      noLink: 'Si necesitás cambiar o cancelar el turno, escribile a la barbería.',

      closing: '¡Te esperamos!',
    },

    /**
     * The shop cancelled the appointment (C2).
     *
     * **This is the message N1 did not send.** T72 records the asymmetry it
     * closes half of: until now the product emailed when nothing was wrong and
     * stayed silent when something was — and here the cause is not a failure
     * but a deliberate decision by the shop, which makes the silence worse.
     *
     * **It carries no link.** The confirmation's link exists so a client can
     * reach a booking that is still theirs; a cancelled one has nothing to do
     * there, and the link is a cancellation token — a credential (T69). Not
     * sending it where it has no use is strictly better than sending it.
     */
    cancellation: {
      subject: (shopName: string, when: string) => `Se canceló tu turno en ${shopName} — ${when}`,
      greeting: (clientName: string) => `Hola ${clientName},`,
      heading: 'La barbería canceló tu turno',
      intro: 'Lamentamos el inconveniente. Este era el turno que quedó cancelado:',

      whenLabel: 'Cuándo era',
      whereLabel: 'Dónde',
      barberLabel: 'Barbero',
      serviceLabel: 'Servicio',

      /**
       * Added only when a deposit was actually approved. Same honesty the
       * slot-lost page state uses: the money moved, and this system does not
       * move it back — so it says who to talk to instead of implying a process
       * that does not exist.
       */
      depositLabel: 'Seña pagada',
      depositNote:
        'Tu seña no se devuelve por este sistema. Escribile a la barbería para coordinar la devolución.',

      /** No link, so the closing is the only call to action there is. */
      closing: 'Podés reservar otro turno cuando quieras.',
    },

    /**
     * The appointment is tomorrow (N2).
     *
     * **The link is the message, not a courtesy at the bottom of it.** The
     * confirmation carries a link so a client can reach a booking that is still
     * theirs; this one carries the same link because a client who has changed
     * their mind is the only person who can free the slot while it is still
     * resellable, and this is the one moment the product puts that control in
     * front of them. The wording therefore leads with cancelling rather than
     * mentioning it last.
     *
     * **It must not imply the appointment is in doubt.** "Confirmá tu turno"
     * would read as a booking that lapses if ignored, and this one does not —
     * the deposit already confirmed it. The client has to do nothing, and the
     * copy says so before it offers the link.
     */
    reminder: {
      subject: (shopName: string, when: string) => `Recordatorio: tu turno en ${shopName} — ${when}`,
      greeting: (clientName: string) => `Hola ${clientName},`,
      heading: 'Te recordamos tu turno',

      /**
       * Says "no tenés que hacer nada" before anything else. Without it a
       * message arriving the day before reads as a request for action, and a
       * client who does nothing wonders whether they still have the turn.
       *
       * **It must not name a day, and the first version did.** It read "Tu
       * turno es mañana", which is false whenever the message is not sent
       * exactly one lead before the appointment — and the candidate window's
       * near edge is deliberately **open**, so a booking due in an hour is
       * still reminded (a run that was skipped, or a Worker that was down,
       * catches up on the next tick rather than dropping the client). A
       * reminder telling somebody their appointment is "mañana" ninety minutes
       * before it starts is worse than no reminder: they will plan around the
       * wrong day.
       *
       * The date and time are in the "Cuándo" row, computed from the
       * appointment itself, which is the only place they can be right.
       */
      intro: 'No tenés que hacer nada, tu turno ya está confirmado:',

      whenLabel: 'Cuándo',
      whereLabel: 'Dónde',
      addressLabel: 'Dirección',
      barberLabel: 'Barbero',
      serviceLabel: 'Servicio',
      depositLabel: 'Seña pagada',
      balanceLabel: 'A pagar en el local',

      /**
       * **Cancelling first, and that is the whole reason this message exists.**
       * The confirmation's equivalent line says "ver o cancelar" because at
       * that moment seeing is what the client wants. A day before the
       * appointment the useful action is the other one — and a slot released
       * now is a slot the shop can still sell.
       *
       * It does not say the link cancels anything: following it renders a page,
       * and cancelling takes a further deliberate step. That distinction is
       * T69's mitigation and the wording must not blur it — the same constraint
       * the confirmation's `linkIntro` carries.
       */
      linkIntro: 'Si no vas a poder venir, avisanos desde acá para liberar el turno:',
      linkLabel: 'Ver o cancelar mi turno',

      /**
       * No origin, so no link. It cannot offer the page, so it offers the only
       * other thing a client can act on.
       *
       * **The loss here is larger than on the confirmation path**, and the copy
       * cannot hide that: a confirmation without a link is still a receipt,
       * while a reminder without one has had its purpose removed and leaves the
       * client exactly where they were before it arrived.
       */
      noLink: 'Si no vas a poder venir, escribile a la barbería para avisar.',

      closing: '¡Te esperamos!',
    },
  },
} as const;
