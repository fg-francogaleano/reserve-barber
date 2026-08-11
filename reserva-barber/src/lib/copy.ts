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
