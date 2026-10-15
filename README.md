# PetCare

Aplicación Ionic/Angular para gestionar usuarios, mascotas y sus cuidados. Incluye autenticación local, perfiles por cuenta, persistencia SQLite, agenda con recordatorios, historial de atenciones, fotos, videos, geolocalización, Bluetooth LE y lectura/escritura NFC.

La aplicación combina almacenamiento en el dispositivo con una API local para los registros de atención. El descubrimiento y la conexión BLE son reales; las métricas de la vista de sensores y las alertas iniciales son demostrativas.

## Equipo de desarrollo

El proyecto PetCare fue desarrollado de manera colaborativa por el Grupo C  2026-33 de la asignatura Programación de Dispositivos Móviles (ISW-307). Cada integrante asumió la responsabilidad principal de un módulo específico, manteniendo la integración dentro de un único repositorio central.

| Integrante | Matrícula | Módulo asignado | Unidades |
| --- | --- | --- | --- |
| Henybel Vásquez Mendoza | 100074999 | Usuarios, mascotas y almacenamiento | U3, U9 |
| Darlyn Giomal Francisco Peña | 100011821 | Geolocalización y conectividad | U4, U6 |
| Flérida Ulerio Santos | 100022531 | Multimedia y cámara | U7, U8 |
| Carlos Daniel Marte Duarte | 100056063 | Bluetooth/NFC y servicios web | U5, U10 |

El trabajo se desarrolló de forma grupal en un repositorio común, pero cada integrante es responsable de la implementación, documentación y defensa técnica de su módulo asignado.


## Tecnologías y requisitos

| Tecnología | Uso |
| --- | --- |
| Angular 22 e Ionic 9 | Componentes standalone, formularios, signals y pestañas. |
| Capacitor 8 | Android, cámara, ubicación, red, compartir y notificaciones. |
| SQLite y jeep-sqlite | Usuarios, mascotas y planes de cuidado; soporte web sobre IndexedDB. |
| IndexedDB | Archivos de video y sus metadatos. |
| Leaflet y OpenStreetMap | Mapa, búsqueda de ubicaciones y establecimientos. |
| Node.js | API local con persistencia JSON. |

Para ejecutar la versión web necesitas npm y Node.js compatible con el Angular CLI instalado: `^22.22.3 || ^24.15.0 || >=26.0.0`.

Para Android necesitas Android Studio, un JDK y el SDK configurados para el proyecto. La configuración actual usa SDK mínimo 24 y SDK de compilación/destino 36. NFC y BLE requieren hardware compatible.

## Instalar y ejecutar

Desde una terminal:

~~~powershell
git clone https://github.com/heny5/PetCare.git
cd PetCare
npm ci
npm start
~~~
Como alternativa para una instalación manual también puede utilizarse:

~~~powershell
npm install
ionic serve
~~~

Para PetCare se recomienda `npm start`, ya que este comando inicia tanto la aplicación Angular como la API local utilizada por el proyecto.

Si ya tienes el repositorio, ejecuta `npm ci` y `npm start` desde su carpeta. `npm ci` instala las versiones de `package-lock.json`.

Abre [http://localhost:4200](http://localhost:4200). `npm start` ejecuta Angular y la API local en el puerto 3000. Para iniciarlos por separado, usa dos terminales:

~~~powershell
npm run server
~~~

~~~powershell
npm run start:app
~~~

Para comprobar la API:

~~~powershell
Invoke-WebRequest -UseBasicParsing http://localhost:3000/health
~~~

## Usuarios, sesión y mascotas

### Registro e inicio de sesión

La pantalla `/login` alterna entre ingreso y registro. El registro solicita usuario, contraseña y teléfono; comprueba que usuario y teléfono no estén repetidos en SQLite. Las contraseñas se guardan como claves derivadas con PBKDF2/SHA-256, sal aleatoria de 16 bytes y 210 000 iteraciones.

Al iniciar sesión, `AuthService` verifica la contraseña y conserva el nombre de usuario en `localStorage`, bajo `petcare.auth.username`. Los guards protegen las pestañas y la ruta de localización. El menú de usuario permite cerrar sesión y regresar al login.

Las cuentas son locales al almacenamiento de esa instalación o navegador. La sesión de la interfaz no autentica las peticiones a la API Node: `server.mjs` no implementa login ni tokens.

### CRUD y relación usuario-mascotas

En **Mascotas**, pulsa **＋** para registrar una ficha. El nombre y la especie son obligatorios. Puedes indicar raza, sexo, edad, peso, fecha de nacimiento y notas importantes. Si introduces una fecha de nacimiento, la aplicación calcula la edad.

Cada ficha permite consultar sus datos, editarlos y solicitar su eliminación mediante confirmación. Las consultas, actualizaciones y eliminaciones de SQLite se filtran por el usuario activo. La relación es `pets.user_id → users.id`; los planes de cuidado también están vinculados al usuario y a la mascota.

**Los perfiles actuales se guardan en SQLite y no se sincronizan con `/api/pets`.** `PetService.sync()` recarga los datos locales de la cuenta. Cuando una cuenta no tiene mascotas, el servicio puede importar una vez perfiles válidos de la antigua clave `petcare.pets`; la migración se marca con `petcare.legacy-pets-migrated`.

## Almacenamiento y persistencia

| Datos | Almacenamiento actual |
| --- | --- |
| Usuarios y contraseñas derivadas | SQLite, base `petcare`, tabla `users`. |
| Perfiles de mascotas | SQLite, tabla `pets`, asociados a `user_id`. |
| Agenda, controles y recordatorios | SQLite, tabla `care_plans`. |
| Nombre de usuario de la sesión | `localStorage`: `petcare.auth.username`. |
| Fotos de las fichas | `localStorage`: `petcare.fotos-mascotas`, imágenes Base64 por ID de mascota. |
| Videos | IndexedDB, base `petcare-media`, almacén `videos`, índice compuesto `ownerPet`. |
| Atenciones pendientes | `localStorage`: `petcare.pending-care-records`. |
| Última ubicación | `localStorage`: `petcare-last-location`. |
| Estado de mascota perdida | `localStorage`: `petcare.lost-pets`, separado por usuario y mascota. |
| Alertas del collar | `localStorage`: `petcare-alertas`. |
| Atenciones recibidas por la API | `data/care-records.json`. |
| Perfiles gestionados directamente por la API | `data/pets.json`; independientes de las fichas SQLite. |

En Android, SQLite utiliza la conexión nativa. En web, `src/main.ts` registra jeep-sqlite antes de iniciar Angular; `DatabaseService` abre el almacén web y persiste las escrituras mediante `saveToStore`. Las tablas se crean si no existen y se agregan las columnas previstas que falten en bases anteriores.

Los archivos JSON de la API están ignorados por Git. Borrar los datos del sitio o de la aplicación elimina el almacenamiento local correspondiente; los archivos del servidor se mantienen por separado. El proyecto no configura un service worker para garantizar la apertura o recarga de la web sin conexión.

## Cuidados, historial y recordatorios

La pestaña **Cuidados** permite programar citas, alimentación, vacunas, desparasitación, medicamentos, peluquería, paseos y otros cuidados. También admite controles de salud con peso, temperatura o ambos.

- Los planes se guardan en SQLite para la cuenta y mascota seleccionadas.
- Pueden marcarse como realizados, reactivarse o eliminarse.
- La alimentación admite cantidad y repetición por días; las vacunas admiten número de dosis y próxima fecha.
- Al completar un plan con repetición o próxima dosis, se crea el siguiente registro cuando corresponde.
- Los controles de salud se guardan como realizados y aparecen en el historial.
- Los avisos pueden activarse o desactivarse por plan, con permiso de notificaciones.

`CareNotificationService` programa hasta 60 avisos futuros: el horizonte es de un año en plataformas nativas y de 20 días en web. Su disponibilidad depende de los permisos y del soporte de la plataforma; en web no se garantiza su ejecución con la página cerrada.

La pestaña **Historial** permite elegir una mascota, consultar sus eventos y registrar atenciones que ya ocurrieron. Combina las atenciones recibidas de la API, las pendientes locales y los planes realizados. La interfaz filtra los registros por propietario y mascota; los registros antiguos sin ID de mascota pueden coincidir por nombre.

### Conectividad y sincronización de atenciones

`ConnectivityService` comparte el estado de red entre la interfaz y `CareRecordService`, mediante eventos `online/offline` y Network de Capacitor.

1. Comprobar la mascota seleccionada, la sesión y la descripción.
2. Crear un identificador y guardar la atención en la cola local antes de enviarla.
3. Con conexión, enviar los pendientes en orden a `environment.apiUrl`.
4. Retirar cada pendiente únicamente después de una respuesta HTTP correcta.
5. Si la API falla o la petición supera **10 segundos**, conservar el registro.
6. Reintentar cada **15 segundos** mientras haya conexión y pendientes, al recuperar la red o al pulsar **Sincronizar ahora**.

Los envíos concurrentes comparten una sola operación. La cola incluye `id`, `petName`, `description`, `createdAt`, `queuedAt` y, cuando están disponibles, `category`, `petId` y `owner`.

Al iniciar, el servicio migra la antigua cola `petcare-pendientes`, evita duplicados por ID y conserva los elementos que no pudo convertir. Las atenciones aceptadas se guardan realmente en `data/care-records.json`.

## Multimedia y cámara

Desde la ficha, **Editar foto** permite elegir una imagen de galería o capturarla con la cámara. La miniatura obtenida se guarda como imagen Base64 en el mapa local de fotos.

Desde **Historial**, **Agregar video** importa un clip de galería para la mascota seleccionada. El límite es de **60 segundos y 35 MB**. Se puede añadir una nota de hasta 120 caracteres. El archivo y sus metadatos se guardan en IndexedDB por usuario y mascota.

El álbum muestra miniaturas, fechas y duración, y permite reproducir y eliminar videos. El reproductor dispone de controles del navegador, velocidades de 1×, 1.25×, 1.5× y 2×, y pantalla completa cuando esté disponible. Los videos permanecen en el dispositivo; no se suben a la API. Las URLs temporales de reproducción se liberan al cambiar el álbum o eliminar un clip.

## Geolocalización y mapa

La ruta protegida `/location` utiliza Geolocation de Capacitor y Leaflet:

- Obtener coordenadas, precisión y hora de actualización.
- Recuperar una lectura guardada de hasta un día mientras se solicita una nueva.
- Solicitar una mejora de precisión en segundo plano en web.
- Activar o detener el seguimiento continuo.
- Compartir coordenadas y un enlace de OpenStreetMap con Capacitor Share.
- Buscar ubicaciones por texto con Nominatim, a partir de tres caracteres.
- Consultar tiendas, alimentos para mascotas y veterinarias con Overpass, en un radio de 1 a 20 km.

El mapa utiliza teselas de OpenStreetMap. Las búsquedas y la descarga del mapa requieren conexión; la ubicación depende de los permisos y del proveedor disponible. El seguimiento se detiene al destruir la pantalla.

## Bluetooth LE, NFC y mascota perdida

### Bluetooth LE

La vista **Conectar dispositivo** utiliza `@capacitor-community/bluetooth-le`. Busca dispositivos durante ocho segundos, actualiza sus resultados sin repetir IDs y permite conectar o desconectar uno. Al conectar otro equipo, cierra primero el enlace anterior. El callback de desconexión actualiza la interfaz.

El enlace GATT es real, pero el proyecto no implementa lectura de características del collar para alimentar las métricas de temperatura, pasos, batería o descanso. Los valores de **Estado del sensor** y las alertas iniciales son demostrativos.

### NFC

La pestaña **NFC** usa `@capgo/capacitor-nfc` para leer texto NDEF y escribir una ficha básica de la mascota seleccionada. La ficha contiene tipo, versión, ID, nombre, especie y raza. Al leerla, la aplicación permite abrir una mascota local si coinciden su ID y nombre.

NFC requiere ejecutar la app nativa en un equipo compatible, con NFC activado. La espera de detección es de treinta segundos. Bluetooth en web depende del navegador y sus permisos; para verificar ambas funciones, utiliza un teléfono Android compatible y una etiqueta NFC.

### Mascota perdida y QR

Desde la ficha se puede activar una alerta de mascota perdida y generar un QR con sus datos y el teléfono de la cuenta. El estado se conserva localmente por usuario y mascota; el QR contiene texto de contacto. Al marcarla como encontrada, se desactiva la alerta.

La vista **Compartir expediente** es demostrativa: su botón muestra un mensaje y no transfiere archivos. Es independiente de la escritura NFC y de la acción real para compartir ubicación.

## API local

`server.mjs` escucha por defecto en el puerto 3000. Puedes cambiarlo mediante `PORT`; ajusta también las URLs de los entornos que vayan a consumirla.

| Método y ruta | Función |
| --- | --- |
| `GET /health` | Devuelve `{"status":"ok"}`. |
| `GET /api/care-records` | Devuelve las atenciones guardadas. |
| `POST /api/care-records` | Guarda una atención; admite categoría, propietario e ID de mascota. |
| `GET /api/pets` | Devuelve los perfiles del archivo JSON de la API. |
| `POST /api/pets` | Crea un perfil JSON y evita duplicados por ID. |
| `PUT /api/pets/:id` | Guarda un perfil con el mismo ID que la URL. |
| `DELETE /api/pets/:id` | Elimina el perfil JSON indicado. |

La API valida los campos, serializa las escrituras y evita duplicados por ID en los POST. No aplica autenticación ni filtrado por cuenta; el historial de la interfaz filtra sus resultados. Los endpoints de mascotas se mantienen en el servidor, pero `PetService` utiliza SQLite.

| Entorno | `apiUrl` | `petsApiUrl` |
| --- | --- | --- |
| Desarrollo | `http://localhost:3000/api/care-records` | `http://localhost:3000/api/pets` |
| Producción | `/api/care-records` | `/api/pets` |

La compilación de producción escribe los recursos web en `www`; no arranca ni despliega la API. Para servir el historial remoto, el alojamiento debe resolver `/api/care-records`. `petsApiUrl` permanece configurado para los endpoints de perfiles JSON.

## Ejecutar en Android

El repositorio incluye la plataforma Android. Desde la raíz:

~~~powershell
npm run build
npx cap sync android
npx cap open android
~~~

Selecciona un dispositivo en Android Studio y ejecuta la aplicación. También puedes usar `npx cap run android` con el entorno configurado. Después de cambiar recursos web o plugins, vuelve a compilar y sincronizar.

En un teléfono, `localhost` se refiere al propio teléfono. Para acceder a la API del equipo, configura en el entorno que vayas a compilar una dirección accesible desde el dispositivo. `npm run build` usa producción; para desarrollo, ejecuta `npm run build -- --configuration development` antes de sincronizar.

El manifiesto Android incluye permisos de red, ubicación, cámara, NFC y Bluetooth, y permite tráfico HTTP mediante `usesCleartextTraffic`. Los permisos en ejecución y la disponibilidad del hardware también influyen en las funciones nativas.

## Verificación manual y problemas frecuentes

Para comprobar la persistencia, crea una cuenta y una mascota, edita su ficha y recarga la aplicación. Cierra sesión, crea otra cuenta y comprueba que su lista SQLite sea independiente. Vuelve a la cuenta original para verificar sus datos.

Para comprobar la cola sin conexión:

1. Inicia `npm start`, entra en tu cuenta y crea o selecciona una mascota.
2. Abre **Historial** y selecciona esa mascota.
3. Activa **Offline** en la pestaña Network de DevTools, o desconecta la red manteniendo abierta la aplicación.
4. Registra una atención y comprueba que aparece pendiente.
5. Restablece la conexión y verifica que el contador llegue a cero con la API disponible.
6. Consulta `GET /api/care-records` para comprobar el registro persistido.

Para probar los reintentos con conexión activa, inicia Angular y la API por separado, detén solo la API y guarda una atención. Reinicia la API: se enviará en un próximo reintento. La interfaz utiliza la conexión real; no tiene botones propios para simular **Offline**, **En línea** o **Red real**.

- **Atenciones pendientes:** comprueba `/health` y la petición a `/api/care-records`. Estar conectado no garantiza que la API responda.
- **Error de SQLite en web:** comprueba la carga de jeep-sqlite y la disponibilidad del almacenamiento del navegador.
- **No aparecen mascotas de otra instalación:** las cuentas y fichas SQLite son locales; `/api/pets` no las replica.
- **No se obtiene ubicación:** revisa permisos y disponibilidad del proveedor; en web, usa localhost o un contexto HTTPS.
- **NFC o BLE no disponibles:** verifica plataforma, hardware, permisos y que la función esté activada.
- **Videos o fotos no se guardan:** revisa los límites del clip y el espacio de almacenamiento.
- **Puerto ocupado:** detén el proceso anterior o cambia el puerto y su configuración.

## Archivos principales

| Archivo | Responsabilidad |
| --- | --- |
| `src/main.ts` | Preparación de jeep-sqlite en web e inicio de Angular. |
| `src/app/app.routes.ts` | Rutas, pestañas y guards. |
| `src/app/auth/auth.page.ts` | Formulario de ingreso y registro. |
| `src/app/home/home.page.ts` | Lógica compartida de perfiles, cuidados, fotos, videos y conectividad. |
| `src/app/home/home.page.html` | Vistas, formularios y controles. |
| `src/app/tabs/` | Navegación y componentes de cada pestaña. |
| `src/app/services/auth.service.ts` | Registro, verificación de contraseña y sesión. |
| `src/app/services/auth.guard.ts` | Control de acceso a rutas. |
| `src/app/services/database.service.ts` | SQLite, esquema y consultas por propietario. |
| `src/app/services/pet.model.ts` | Modelo y validación de fichas. |
| `src/app/services/pet.service.ts` | CRUD local y migración de perfiles. |
| `src/app/services/care-plan.service.ts` | Agenda, controles y próximos cuidados. |
| `src/app/services/care-notification.service.ts` | Permisos y programación de avisos. |
| `src/app/services/care-record.service.ts` | Cola persistente y comunicación con la API. |
| `src/app/services/pet-media.service.ts` | Videos en IndexedDB y reproducción. |
| `src/app/services/connectivity.service.ts` | Estado de red compartido. |
| `src/app/services/device-link.service.ts` | BLE y lectura/escritura NFC. |
| `src/app/location/location.page.ts` | Ubicación, seguimiento, mapa y compartir. |
| `src/app/services/places.ts` | Consultas a Nominatim y Overpass. |
| `src/environments/` | URLs de API de desarrollo y producción. |
| `dev.mjs` | Inicio conjunto de Angular y la API. |
| `server.mjs` | API local y persistencia JSON. |
| `android/app/src/main/AndroidManifest.xml` | Configuración y permisos Android. |

Los archivos de los módulos de usuarios, mascotas, almacenamiento, multimedia, conectividad y geolocalización incluyen comentarios explicativos en español.

## Comandos de validación

~~~powershell
npm run build -- --configuration development
npm run build
npm test -- --watch=false
npm run test:api
npm run lint
~~~

Estos comandos ejecutan compilación de desarrollo y producción, pruebas de Angular/Vitest, pruebas de la API y análisis estático. `npm run test:api` usa un puerto y una carpeta temporales, sin modificar los datos de desarrollo.

Las pruebas de mascotas en `pet.service.spec.ts` y `home.pets.spec.ts` todavía contienen expectativas de la implementación anterior con localStorage, perfiles de ejemplo y sincronización remota. Deben adaptarse al contrato actual de sesión, SQLite y operaciones asíncronas; no representan una validación completa de ese módulo. Los comandos anteriores permiten comprobar el estado de las suites y no implican que todas estén pasando.
