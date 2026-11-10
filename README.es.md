# Routing para Herdr

[English](README.md) · **Español**

Un panel lateral que muestra el enrutamiento de [Magpie](https://github.com/yetone/magpie) dentro de Herdr, justo al lado de Files y Changes.

La ventana de Magpie es un webview de Wails y los paneles de Herdr son gpui, así que la aplicación no se puede incrustar. En su lugar, el panel lee los mismos datos que lee la página Routing de Magpie:

- **En vivo:** `GET http://127.0.0.1:<gateway>/v1/magpie/trace` (long-poll mientras el panel está abierto)
- **Hoy:** `~/.config/magpie/routing/<YYYY-MM-DD>.jsonl`

## Qué muestra

Un solo escenario: el agente, Magpie y las **cuentas** que sopesó, dispuestas como filas. Cada solicitud en vuelo es su propio pájaro, con el color de su agente, así que se pueden observar varios agentes a la vez.

- **Franja de vuelos en curso** (dos o más a la vez): el agente, su espacio de Herdr, qué está esperando y un reloj en vivo. Haz clic en uno para seguirlo.
- **Las cuentas son filas compartidas.** Una fila indica cuántas solicitudes tiene, con los colores de sus agentes. Una cuenta que falla se pone roja con su estado; la solicitud vuelve a Magpie y sale hacia la siguiente cuenta.
- **Enlace con Herdr.** Magpie registra la carpeta como una etiqueta corta (`deepseek-harness/mod-magpie`), que se empareja con la carpeta activa de un terminal, así que la tarjeta del agente y el registro muestran qué espacio envió la solicitud. Haz clic en la tarjeta del agente para ir a ese terminal. Cuando hay varios agentes en una misma carpeta, gana el que está trabajando.
- **Registro de solicitudes.** Haz clic en una solicitud para reproducir su recorrido; "Back to live" vuelve a seguir la más reciente.
- **Demo** (encabezado): una tarde guionizada con tres agentes, cinco solicitudes y un doble failover, para ver el panel sin enviar nada.

Teclas (haz clic primero en el panel): `↑`/`↓` o `j`/`k` recorren las solicitudes, `Esc` vuelve a la vista en vivo, `r` reproduce de nuevo, `m` oculta los nombres y `d` activa o desactiva la demo.

## Instalación

Un comando (Node 18+ y Herdr abierto):

```sh
npx github:Izzy2024/magpie-mod
```

O clona el repo y ejecuta `node scripts/install.mjs`. `--dry-run` muestra el plan; `--uninstall` quita el mod y el botón.

El script copia `mods/routing` y añade el botón **Routing** después de Changes. Herdr reemplaza su layout `main` y el mod `tabs` en cada arranque, así que en esa ventana el script los clona como `main-routing` y `tabs-routing` y cambia a ese clon (`ctrl-shift-l` vuelve al anterior). Un layout personal se edita donde está y sigue en pantalla.

`node scripts/check-logic.mjs` comprueba la geometría del vuelo sin gateway ni registro.

Galería: con el topic `herdr-mod`, el repo aparece en [herdr.dev/mods/Izzy2024/magpie-mod](https://herdr.dev/mods/Izzy2024/magpie-mod). A un agente: `Read ~/.config/herdr-app/AGENTS.md, then add this mod: herdr.dev/mods/Izzy2024/magpie-mod`. La receta le pide ejecutar el instalador, porque copiar solo la carpeta no muestra el panel.

## Cómo está construido

- `mods/routing/logic.js`: sin UI ni E/S. Lee una ruta, traza los cables (`wiresOf`), ejecuta la coreografía de vuelo (`advance`) y ofrece `frame()`, que decide en cada fotograma qué solicitudes vuelan y en qué filas. Los cables son ortogonales con esquinas redondeadas (radio de 8 px): bajan de Magpie a un bus horizontal, van a la izquierda hasta un carril junto a las cuentas, y luego bajan y entran a cada cuenta. Cada cable estático se dibuja una sola vez (`base`: el cable del agente más uno por cuenta). `check-logic.mjs` reproduce la demo a través de `frame()` y valida el resultado, y comprueba la geometría de cables y vuelos en tres anchos de panel.
- `mods/routing/main.js`: tres vistas. `Routing` es dueña de los datos y del registro. `Stage` es la tarjeta (se redibuja cuando cambia lo que muestra, y cuatro veces por segundo para los relojes). `Flight` es lo que se mueve (cables discontinuos, pájaros, paquetes). Los vuelos van a unos 60 fps (un temporizador de 16 ms), la espera en Magpie a unos 30 fps, y la espera en una cuenta no usa ningún fotograma de JS: el cable queda encendido y el punto pulsa de forma nativa. El alabeo y el volteo siguen el tiempo real, no el número de fotogramas, así que se ven igual a cualquiera de las dos cadencias.

## Costo

Sin nada en vuelo, el panel no añade nada (la aplicación está inactiva en torno al 10 % de un núcleo en esta máquina, con o sin él). En el peor caso, cuatro pájaros en el aire de forma continua (la demo): alrededor de +30–40 % de un núcleo, medido en ventanas de 40 s con resolución de 1 s de tiempo de CPU. Esa cifra se midió cuando los vuelos iban a 30 fps. Ahora los vuelos van a unos 60 fps, y una solicitud que espera en una cuenta ya no consume fotogramas; el costo no se ha vuelto a medir desde entonces, así que la cifra está desactualizada. La mayor parte es el repintado de la ventana, que cualquier animación en Herdr paga; las partes evitables ya no están (el feed se fusiona una vez por cambio, la geometría de los cables se mide una vez, los cables estáticos se dibujan una vez y el árbol de layout se lee cuatro veces por segundo).

