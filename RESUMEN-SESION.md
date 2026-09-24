+# MediRecord — Resumen de sesión y del proyecto

Fecha: 17/09/2026
Proyecto: `C:\Users\levim\MediRecord`

## 1. Qué es el proyecto

**MediRecord** es una aplicación móvil de recordatorio de medicamentos (pastillas y tratamientos),
construida con **React Native CLI puro (bare), sin Expo ni Expo Go**.

Funcionalidades principales:

- Registro de medicamentos con dosis, concentración, stock y notas.
- Pautas de horario: diaria, por intervalo de horas, días de la semana y ciclos con descanso.
- Control de tomas del día (tomada / omitida / pospuesta) con porcentaje de adherencia.
- Notificaciones locales con acciones ("Tomada" / "Posponer 10 min").
- Control de inventario con aviso de stock bajo y recarga.
- Historial de tomas con filtros y exportación de informe en PDF.
- Modo claro, oscuro y sistema (persistido en la base de datos).
- 100% offline: todos los datos viven en SQLite dentro del dispositivo, sin nube.
- Interfaz completa en español.

El proyecto existente con Expo (`C:\Users\levim\medication-reminder`) **no se tocó**;
MediRecord se creó como proyecto separado.

## 2. Stack técnico

| Capa           | Elección                                                                 |
|----------------|--------------------------------------------------------------------------|
| Base           | React Native CLI 0.87 (bare), TypeScript, Hermes                         |
| Base de datos  | `@op-engineering/op-sqlite` (SQLite offline-first)                       |
| Notificaciones | `@notifee/react-native` (locales, con acciones)                          |
| PDF / compartir| `react-native-html-to-pdf` + `react-native-share`                        |
| UI             | Componentes propios (`src/ui.tsx`), `react-native-safe-area-context`     |
| Tests          | Jest (21 tests), `tsc --noEmit`, ESLint                                  |

## 3. Estructura del proyecto

```
MediRecord/
├── App.tsx                        # Entrada: SafeArea + AppRoot
├── index.js                       # Registro del componente
├── src/
│   ├── domain.ts                  # Tipos Medication/Dose/AppState, validación, occurrences()
│   ├── storage.ts                 # SQLite: loadState, saveMedication, deleteMedication
│   │                              # (archiva, conserva historial), recordDose (idempotente,
│   │                              # descuenta stock sin negativos), addStock, setTheme
│   ├── notifications.ts           # syncNotifications (máx. 50, horizonte 7 días),
│   │                              # requestNotifications, snooze, handleNotificationEvent
│   ├── reports.ts                 # Informe PDF (HTML escapado) + compartir
│   ├── ui.tsx                     # UI completa en español (tabs, formularios, ajustes)
│   └── assets/
│       ├── Logo.tsx               # Logo (Logo, LogoMark, LogoSplash)
│       └── icons/medirecord-icon.svg
├── __tests__/
│   ├── domain.test.ts             # 19 tests de pautas y validación
│   └── App.test.tsx               # 2 tests de render y tema
└── android/app/build.gradle       # Firma release con keystore propio
```

## 4. Lo hecho en esta sesión

### 4.1 Creación del proyecto nativo
- `npx @react-native-community/cli init MediRecord` (RN 0.87.1).
- Instaladas: `@op-engineering/op-sqlite`, `@notifee/react-native`,
  `react-native-html-to-pdf`, `react-native-share`; eliminado `@react-native/new-app-screen`.
- Verificados Java (Android Studio JBR 21), SDK Android y `adb` (sin dispositivo conectado).

### 4.2 Backend offline (dominio, almacenamiento, notificaciones, informes)
- `src/domain.ts`: tipos `Medication` (id, nombre, concentración, dosis, unidad, stock,
  aviso de stock bajo, notas, inicio/fin, activa, pauta), `Dose`, `AppState`;
  `occurrences(med, from, to)` con horarios diarios en hora local e intervalos por tiempo
  transcurrido; validación estricta con mensajes claros.
- `src/storage.ts`: esquema SQLite (`medications`, `doses`, `app_settings`); borrado lógico
  (archivar conserva historial); registro de tomas idempotente con descuento de stock atómico.
- `src/notifications.ts`: hasta 50 recordatorios en ventana de 7 días, excluye pasado/registrado/
  archivado, conserva pospuestos al resincronizar, degradado elegante sin permiso de alarma exacta.
- `src/reports.ts`: PDF con datos escapados, sin consejos médicos, aviso de datos personales.
- 19 tests de dominio en verde.

### 4.3 Interfaz completa en español
- Pestañas **Hoy / Medicamentos / Historial / Ajustes**.
- Hoy: héroe de adherencia %, lista de tomas (tarde/tomada/omitida), botones
  **Tomada / Omitir / Posponer**, confirmaciones con `Alert`.
- Medicamentos: tarjetas con stock, editar, añadir stock (modal con validación),
  pausar/reanudar, archivar con confirmación.
- Historial: filtros Todas/Tomadas/Omitidas, fecha programada y real, exportar PDF.
- Ajustes: tema sistema/claro/oscuro, permiso de notificaciones (solo bajo demanda),
  resincronizar, abrir ajustes del sistema, avisos honestos (límite 50/7 días, batería,
  cierre forzado) y aviso de "no es consejo médico".
- Refresco + resincronización al modificar datos y al volver a primer plano;
  manejador de eventos Notifee en foreground.

### 4.4 Compilación y APK release
- `assembleDebug` y `assembleRelease` **BUILD SUCCESSFUL**.
- Keystore generado: `android/app/medirecord-release.keystore`
  (alias `medirecord`, pass `medirecord`) yconfigurado `signingConfigs.release`
  en `android/app/build.gradle`. **Respaldar el keystore**: sin él no se puede
  actualizar la app manteniendo la firma.
- APK release firmado copiado a `Desktop\MediRecord-v1.0-release.apk` (66.6 MB).

### 4.5 Rediseño UI (última iteración)
- Paleta suavizada en claro y oscuro, tarjetas con radio 20 y sombras sutiles,
  botones/inputs más redondeados (46–48 px de alto).
- Nuevo encabezado con logo en cada pestaña (marca + sección + fecha en español)
  y pantalla de carga con logo.
- Barra de pestañas corregida: respeta el safe-area inferior, pastilla activa con
  letra identificativa (H/M/R/A), área táctil 56 px, sombra superior; toast
  reposicionado para no taparla.
- Nuevo `TimesEditor`: editor de horarios desplegable con accesos rápidos
  (08:00, 12:00…), selector hora/minuto + **Añadir** y chips para quitar (✕);
  en modo intervalo edita el ancla única. Sustituye al input de texto con comas.
- Logo propio (`src/assets/Logo.tsx`: cruz médica blanca sobre verde `#2A9D8F`
  con pastilla) e iconos launcher regenerados en las 5 densidades
  (`ic_launcher` + `ic_launcher_round`).
- Re-verificado: `tsc` limpio, ESLint 0 errores, Jest 21/21, `assembleRelease` OK,
  APK actualizado.

## 5. Estado de verificación

- `npx tsc --noEmit` → limpio.
- `npx eslint` → 0 errores (20 warnings `no-void` preexistentes).
- `npx jest` → 21/21 en verde (2 suites).
- `gradlew assembleRelease` → BUILD SUCCESSFUL.
- Ejecución en dispositivo **pendiente** (no había emulador ni móvil conectado):
  `npx react-native run-android` con depuración USB.

## 6. Entregables

| Entregable | Ubicación |
|------------|-----------|
| Código fuente | `C:\Users\levim\MediRecord` |
| APK release firmado | `C:\Users\levim\Desktop\MediRecord-v1.0-release.apk` (66.6 MB) |
| Keystore (respaldar) | `C:\Users\levim\MediRecord\android\app\medirecord-release.keystore` |

## 7. Pendientes / próximos pasos sugeridos

1. Probar en emulador o móvil (`npx react-native run-android`).
2. Registrar el manejador de Notifee en segundo plano en `index.js` (opcional):
   `registerBackgroundHandler` → `handleNotificationEvent`.
3. Sustituir el icono autogenerado por un diseño profesional (48/72/96/144/192 px)
   si se desea.
4. Subir versión (`versionCode`/`versionName`) y publicar (Play Store / APK directo).

## 8. Notas

- Durante la sesión hubo errores temporales de red (504 upstream); se reintentó y
  todo quedó en verde.
- Sin Expo en el proyecto: `package.json` no contiene ningún paquete `expo*`.
- La app declara honestamente sus límites: 50 recordatorios / 7 días, posible
  retraso por optimización de batería o cierre forzado en Android.
