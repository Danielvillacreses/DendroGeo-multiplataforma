# DendroGeo

Aplicación de campo y plataforma web para el **registro georreferenciado y el monitoreo histórico de árboles**. Un solo código se entrega de tres formas:

| Plataforma | Cómo se usa | Archivo |
|---|---|---|
| **Android** | App nativa instalable (APK) o publicada en Google Play | `DendroGeo.apk` / `DendroGeo-PlayStore.aab` |
| **iPhone / iPad** | App nativa por TestFlight / App Store, o la versión web instalada en la pantalla de inicio | `DendroGeo.ipa` |
| **Navegador** (PC, Mac, tablet, celular) | Página web con modo sin conexión, instalable como app (PWA) | carpeta `www/` publicada con HTTPS |

**Enlaces:** app web → <https://danielvillacreses.github.io/DendroGeo-multiplataforma/> · APK e iOS → pestaña [Actions](https://github.com/Danielvillacreses/DendroGeo-multiplataforma/actions) → última ejecución → *Artifacts*.

Las tres versiones usan la misma base de datos en la nube: lo que un técnico registra en su Android aparece en el iPhone de otro y en la computadora de la oficina.

| Función | Cómo lo resuelve |
|---|---|
| Geolocalización precisa | En Android e iOS usa el GPS nativo del teléfono (permiso de ubicación precisa); en el navegador, la API de geolocalización. Promedia lecturas GPS durante 10–120 s, descarta lecturas malas, pondera por precisión (1/σ²) y reporta el error estimado, la dispersión y las coordenadas UTM. También permite ajustar el punto en el mapa o escribir coordenadas. |
| Trabajo sin conexión | En Android e iOS los archivos de la app van dentro del instalador; en la web, un service worker guarda la app. Los datos quedan en el equipo (IndexedDB) y las teselas de mapa ya vistas se guardan para el campo. |
| Almacenamiento en la nube | Supabase: PostgreSQL + PostGIS, autenticación por correo y almacenamiento de fotos. |
| Sincronización automática | Al guardar, al recuperar la conexión, al volver a abrir la app y cada 60 s. Cada registro tiene un UUID generado en el teléfono; los conflictos se resuelven con "gana la última edición". |
| Datos dendrométricos | DAP/CAP, altura total y comercial, copa N–S y E–O, estado sanitario, vigor, fenología, daños, fotos, observaciones y técnico. |
| Cálculos | Área basal, volumen (factor de forma por proyecto), área de copa, biomasa aérea (Chave et al. 2014), carbono (47 %) y CO₂e; incremento periódico anual (IPA) entre mediciones. |
| Control de calidad | Avisa si el DAP bajó frente a la medición anterior, si el incremento es irreal, si la altura comercial supera a la total o si la esbeltez es anómala. |
| Plataforma web | Mapa (satélite/calles), lista con filtros, ficha histórica de cada árbol con gráficos, panel con distribución diamétrica, estado sanitario, evolución por campaña y resumen por especie; exportación CSV (Excel) y GeoJSON (QGIS/ArcGIS). |

## Estructura

```
DendroGeo/
├── www/                        La app (web, y la misma que va dentro de Android e iOS)
│   ├── index.html
│   ├── css/app.css
│   ├── js/
│   │   ├── app.js              Pantallas: Registrar, Mapa, Árboles, Panel, Ajustes
│   │   ├── plataforma.js       GPS nativo, exportar/compartir y detección Android/iOS/web
│   │   ├── calc.js             Fórmulas dendrométricas, promedio GPS y conversión UTM
│   │   ├── store.js            Base de datos local (IndexedDB)
│   │   ├── sync.js             Sincronización con Supabase
│   │   ├── config.js           URL y clave de Supabase
│   │   └── demo.js             Catálogo de especies y datos de ejemplo
│   ├── vendor/                 Capacitor, Leaflet y supabase-js (sin depender de internet)
│   ├── manifest.webmanifest, sw.js, icons/
├── android/                    Proyecto Android Studio (genera el APK)
├── ios/                        Proyecto Xcode (genera la app de iPhone/iPad)
├── resources/                  Ícono y pantalla de inicio de origen
├── capacitor.config.json       Id de la app: ec.dendrogeo.app
├── package.json
├── .github/workflows/compilar.yml   Compila APK, iOS y publica la web automáticamente
├── scripts/firma-ios.py
└── supabase/schema.sql         Tablas, índices espaciales, seguridad (RLS), vistas y especies base
```

## Puesta en marcha

### 1. Crear la base de datos en Supabase (15 minutos)

1. Cree una cuenta y un proyecto en <https://supabase.com> (el plan gratuito alcanza para empezar).
2. Abra **SQL Editor**, pegue todo `supabase/schema.sql` y pulse **Run**. Se puede volver a ejecutar sin perder datos.
3. En **Authentication → Providers → Email** deje activado el ingreso por correo. Para pruebas puede desactivar "Confirm email".
4. En **Project Settings → API** copie la **Project URL** y la clave **anon public**, y escríbalas en `www/js/config.js`. Así la web, el APK y la app de iOS salen ya conectadas. (Si lo deja vacío, cada técnico las ingresa en **Ajustes → Conexión a Supabase**.)

Cada usuario crea su cuenta en **Ajustes**. Quien crea un proyecto queda como administrador. Para dar acceso a otro técnico, ejecute en el SQL Editor:

```sql
select invitar_miembro('<id-del-proyecto>', 'tecnico@correo.com', 'tecnico');  -- roles: admin | tecnico | lector
```

### 2. Compilación automática en GitHub (recomendada: no necesita instalar nada)

1. Cree una cuenta gratuita en <https://github.com> y un repositorio nuevo (puede ser privado).
2. Suba el contenido de esta carpeta (botón **Add file → Upload files**, o con GitHub Desktop). No suba `node_modules/`.
3. Entre a **Actions**: la compilación empieza sola y tarda unos 10 minutos.
4. Al terminar, abra la ejecución → sección **Artifacts** → descargue **DendroGeo-Android**. Adentro está `DendroGeo-prueba.apk`.
5. Para una versión con enlace de descarga permanente, cree una etiqueta: **Releases → Draft a new release → Tag `v1.0.0` → Publish**. El APK queda adjunto a esa versión.

**Web en GitHub Pages:** en **Settings → Pages → Source** elija **GitHub Actions**. La app queda en `https://<usuario>.github.io/<repositorio>/` y se actualiza con cada cambio.

### 3. Android

**Instalar el APK de prueba:** envíe `DendroGeo-prueba.apk` al teléfono (WhatsApp, Drive, cable), ábralo y acepte **Permitir instalar apps de esta fuente**. Sirve para toda la brigada de campo sin pasar por Google Play.

**APK firmado y Google Play:** Google Play exige que la app esté firmada siempre con la misma llave. Créela una sola vez y guárdela en un lugar seguro (si se pierde, no se puede actualizar la app publicada):

```powershell
keytool -genkeypair -v -keystore dendrogeo.jks -alias dendrogeo -keyalg RSA -keysize 2048 -validity 10000
[Convert]::ToBase64String([IO.File]::ReadAllBytes("dendrogeo.jks")) | Set-Clipboard
```

En GitHub → **Settings → Secrets and variables → Actions** cree:

| Secreto | Valor |
|---|---|
| `ANDROID_KEYSTORE_BASE64` | el texto copiado con el segundo comando |
| `ANDROID_KEYSTORE_PASSWORD` | contraseña del almacén |
| `ANDROID_KEY_ALIAS` | `dendrogeo` |
| `ANDROID_KEY_PASSWORD` | contraseña de la llave |

Desde entonces cada compilación entrega además `DendroGeo.apk` (firmado) y `DendroGeo-PlayStore.aab` (el que se sube a Google Play Console; la cuenta de desarrollador cuesta USD 25 una sola vez).

**Compilar en su PC en lugar de GitHub:** instale Node.js 22 y Android Studio, y ejecute:

```powershell
npm install
npx cap sync android
npx cap open android      # Android Studio: Build → Build App Bundle(s) / APK(s) → Build APK(s)
```

### 4. iPhone y iPad

Apple solo permite instalar apps nativas firmadas con una cuenta **Apple Developer Program** (USD 99 al año). Hay dos caminos:

- **Sin cuenta de Apple (inmediato):** abra la versión web en **Safari** → botón **Compartir** → **Agregar a pantalla de inicio**. Queda como app con ícono propio, funciona sin conexión, usa el GPS del iPhone y la cámara, y sincroniza con la misma nube. Es la opción recomendada para empezar.
- **App nativa (TestFlight / App Store):** con la cuenta de Apple, cree en <https://developer.apple.com> el identificador `ec.dendrogeo.app`, un certificado **Apple Distribution** (.p12) y un perfil de aprovisionamiento. Cargue en GitHub estos secretos y la compilación entregará el `.ipa`:

| Secreto | Valor |
|---|---|
| `IOS_CERT_P12_BASE64` | certificado .p12 en base64 |
| `IOS_CERT_PASSWORD` | contraseña del .p12 |
| `IOS_PROFILE_BASE64` | perfil `.mobileprovision` en base64 |
| `IOS_TEAM_ID` | Team ID de 10 caracteres |
| `IOS_EXPORT_METHOD` | `ad-hoc` (instalar en iPhones registrados) o `app-store-connect` (TestFlight / App Store) |

Sin esos secretos, GitHub igual compila la app para el simulador de iOS, lo que confirma que el proyecto está sano. Con una Mac también puede abrirla directamente: `npm install && npx cap sync ios && npx cap open ios`.

### 5. Navegador

La carpeta `www/` es la app web completa. Además de GitHub Pages sirve cualquier hosting con **HTTPS** (el GPS y el modo sin conexión no funcionan en `http://`): por ejemplo <https://app.netlify.com/drop> arrastrando la carpeta `www`. En Chrome o Edge aparece el botón **Instalar la app** en Ajustes.

Para probar en su PC:

```powershell
cd www
python -m http.server 8080      # abra http://localhost:8080
```

### Actualizar la app

Todo el código de pantallas y cálculos está en `www/`. Después de cambiarlo, ejecute `npx cap sync` (o simplemente suba el cambio a GitHub) para que el APK y la app de iOS lleven la versión nueva. La web se actualiza sola en los equipos al abrirla con conexión.

## Flujo de campo

1. **Ajustes**: crear proyecto (factor de forma) y parcelas (código y área en m²).
2. **Registrar → Identificación**: todo se puede crear o corregir sin salir del formulario.
   - **Proyecto** y **Parcela**: botones **+ Nuevo** / **Editar** (nombre, factor de forma, código, área).
   - **Código de placa**: se sugiere el siguiente libre (`P01-001`, `P01-002`…) y se puede escribir cualquier otro. Si el código ya existe, o se elige de la lista, la app **carga ese árbol automáticamente** y el registro pasa a ser una nueva medición. **Cerca de mí** lista los árboles registrados más próximos. **Corregir código** cambia la placa sin perder el historial.
   - **Especie**: se elige del catálogo, de los botones **Usadas**, o se escribe una nueva (se guarda en el catálogo para los próximos registros). **Editar** corrige nombre, familia o densidad.
   - Los técnicos escritos también quedan en la lista para elegirlos después.
3. **Ubicación**: **Capturar posición GPS** (o ajustar en el mapa / escribir coordenadas). En una remedición sirve para comprobar el árbol y, si se desea, reemplazar la posición guardada por una lectura más precisa.
4. **Medición con cinta métrica**: DAP o CAP, altura total, altura comercial y copa N–S / E–O tienen cada una su **cinta deslizable**: se arrastra con el dedo (con inercia), se ajusta de 0,1 en 0,1 con − / +, o se escribe el valor. En una remedición la cinta arranca en el valor anterior. Luego estado sanitario, vigor, fenología, daños, fotos y **Guardar**.
5. **Panel** en la oficina: indicadores por hectárea, crecimiento y exportación.

## Métodos de cálculo

| Variable | Fórmula |
|---|---|
| DAP desde CAP | DAP = CAP / π |
| Área basal (m²) | AB = π/4 · (DAP/100)² |
| Volumen (m³) | V = AB · h · ff (ff = 0,5 por defecto, editable por proyecto) |
| Área de copa (m²) | π/4 · ((d N–S + d E–O)/2)² |
| Biomasa aérea (kg) | 0,0673 · (ρ · DAP² · h)^0,976 — Chave et al. (2014), ρ en g/cm³ |
| Carbono / CO₂e | C = 0,47 · biomasa (IPCC 2006); CO₂e = C · 44/12 |
| IPA | (DAP₂ − DAP₁) / años transcurridos |

Las densidades de madera del catálogo son referenciales; reemplácelas por valores locales o de la *Global Wood Density Database*.

### Precisión del GPS

Un celular a cielo abierto logra 3–5 m; bajo dosel cerrado el error puede pasar de 10 m. El promedio reduce el error aleatorio, pero no el sesgo por señal reflejada. Para precisión submétrica conecte un receptor GNSS externo por Bluetooth y actívelo como "ubicación simulada" en Android (p. ej. con la app del fabricante); DendroGeo lo usará automáticamente. La precisión estimada de cada árbol queda guardada (`precision_m`, `n_muestras_gps`).

## Modelo de datos

`proyectos` → `parcelas` → `arboles` (posición fija, punto PostGIS) → `mediciones` (serie histórica) → `fotos` (Supabase Storage, bucket `fotos-arboles`). `especies` es un catálogo común. Vistas: `v_arbol_actual` (última medición) y `v_incrementos` (IPA por intervalo). Función espacial: `arboles_cerca(lat, lon, radio_m)`.

Los registros nunca se borran físicamente: `deleted = true` se sincroniza a todos los equipos.

## Apariencia

La app tiene **fondo claro** y **fondo oscuro**. Se cambia con el botón de sol/luna de la barra superior o en **Ajustes → Apariencia**, y la elección queda guardada en cada equipo. Mientras el usuario no elija, se usa la apariencia del teléfono o computadora. En Android e iOS también se ajusta el color de la barra de estado.

## Permisos que pide la app

| Permiso | Para qué |
|---|---|
| Ubicación precisa (mientras se usa) | Registrar la posición de cada árbol |
| Cámara y fotos | Fotografiar el árbol o adjuntar desde la galería |
| Internet | Sincronizar con la nube (la app funciona sin él) |

La app no usa la ubicación en segundo plano ni comparte datos con terceros.

## Notas

- En Android e iOS, **Exportar** abre el menú de compartir del teléfono (Drive, WhatsApp, correo, Archivos). En la web, descarga el archivo.
- Los datos de ejemplo ("Parcela demostrativa") son inventados y no se suben a la nube. Bórrelos en **Ajustes**.
- Si varias personas editan la misma medición, gana la edición más reciente (hora del dispositivo). Mantenga la hora del celular automática.
- La exportación CSV usa punto y coma y coma decimal, como Excel en español.
