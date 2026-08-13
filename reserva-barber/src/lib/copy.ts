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
    emptyManage: 'Todavía no cargaste ninguna sucursal. Creá la primera para empezar a recibir reservas.',
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
    notBookableHint:
      'Asignale al menos un barbero activo para que se pueda reservar.',
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
      limitReached: 'Llegaste al máximo de servicios activos. Editá uno existente en lugar de crear otro.',
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
    slugHint: 'Solo minúsculas, números y guiones. Se arma sola a partir del nombre, pero podés cambiarla.',
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
    // The link is real and correct, and it does not resolve yet: the public page
    // ships with B1. Saying so is cheaper than an owner sharing it and sending
    // their clients to a login screen.
    linkNotPublishedYet:
      'Todavía no está publicado: la página que ven tus clientes se habilita en el próximo paso. Guardá el link, pero no lo compartas aún.',
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
