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
    notFoundHeading: 'No encontramos esta barbería',
    // Says nothing about which of the two happened, because the system cannot
    // tell either: the slug may never have existed, or the owner may have
    // changed it and stranded this link (T33).
    notFoundBody:
      'El link puede estar mal escrito o haber cambiado. Pedile el link actualizado a la barbería.',
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
     * Returned from Mercado Pago, notification not processed yet. No spinner
     * and no promise of automatic refresh: the page does not poll, and implying
     * otherwise would leave someone staring at it.
     */
    paymentConfirming: 'Estamos confirmando tu pago',
    paymentConfirmingHelp:
      'Puede tardar un momento. Actualizá esta página en unos segundos para ver el estado.',

    paymentConfirmed: '¡Listo! Tu turno está confirmado',
    paymentConfirmedHelp: 'Te esperamos. Guardá este link por si necesitás cancelar.',

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
} as const;
