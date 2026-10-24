# Adjudicación por consenso para comisiones de arte

## Qué vas a construir

Un escrow para comisiones creativas en GenLayer. El comprador deposita GEN, el vendedor entrega una URL y, si hay desacuerdo, los validadores descargan el entregable, lo comparan con el brief y deciden si se libera el pago o se reembolsa.

No es un escrow con un botón de "aprobar". Es un contrato que puede leer el entregable y juzgar si cumple criterios escritos en lenguaje natural.

El ejemplo vive en `entropia-escrow` y usa un contrato Intelligent Contract en Python. La demo corre en **Studio**, que es gasless, así que no necesitas faucet ni GEN real para probarla.

## Por qué un smart contract normal no alcanza

Un contrato tradicional puede verificar firmas, saldos y hashes. No puede responder preguntas como:

- ¿El texto entregado cumple el brief?
- ¿La pieza menciona los temas que pidió el comprador?
- ¿La URL contiene una entrega real o una página genérica?

Ese tipo de decisión es subjetiva. GenLayer la resuelve con un líder que ejecuta la tarea y validadores que repiten el juicio y comparan el resultado.

## Arquitectura

```text
comprador
  create_order(brief, ttl) payable
        |
        v
   escrow en GEN
        |
vendedor
  submit_delivery(order_id, url, note)
        |
        v
comprador
  dispute(order_id, reason)
        |
        v
resolve_dispute(order_id)
  líder: descarga la URL y pide un JSON al LLM
  validadores: repiten y comparan decision y score
        |
        v
release al vendedor  o  refund al comprador
```

El contrato también tiene `accept` para que el comprador libere sin juicio y `claim_timeout` para reclamar si el vendedor no entrega antes del deadline.

## El contrato

El archivo principal es `contracts/composition_escrow.py`. Los métodos públicos son:

| Método | Quién | Qué hace |
|---|---|---|
| `create_order(brief, ttl_seconds)` | comprador | Deposita GEN y crea la orden |
| `submit_delivery(order_id, delivery_url, delivery_note)` | vendedor | Registra la entrega |
| `accept(order_id)` | comprador | Libera el depósito sin juicio |
| `claim_timeout(order_id)` | comprador | Reembolsa si no hubo entrega |
| `dispute(order_id, reason)` | comprador | Abre la disputa |
| `resolve_dispute(order_id)` | cualquiera | Corre el juicio y paga |
| `get_order`, `get_orders`, `get_order_count`, `get_seller` | lectura | Estado del escrow |

`create_order` rechaza depósitos en cero y evita que el vendedor se compre a sí mismo. El depósito de la demo es 0.5 GEN.

## Cómo juzga el contrato

El líder hace tres cosas:

1. Descarga la URL con `gl.nondet.web.request`. Los errores 4xx se clasifican como `[EXTERNAL]` y los 5xx como `[TRANSIENT]`.
2. Recorta la página a 20,000 caracteres.
3. Pide al LLM un JSON con `decision`, `score` y `reason`.

La rúbrica obliga a citar evidencia antes de decidir. El validador repite la misma tarea y exige coincidencia exacta en `decision` y una diferencia de `score` menor o igual a 30. Si el líder falla, los errores se comparan por prefijo y se fuerza rotación cuando el LLM falla.

La decisión explícita evita el sesgo de "el que se queja gana": una entrega que sí cumple el brief se libera aunque el comprador dispute.

## Demo web

El repo incluye un frontend mínimo en `web/` y un servidor local en `scripts/serve-demo.mjs`. El servidor guarda las llaves de la demo y llama al contrato desde Node. El navegador nunca ve las private keys.

La página tiene cuatro acciones:

1. Crear orden y depositar 0.5 GEN.
2. Entregar una URL.
3. Disputar con un motivo.
4. Resolver con consenso.

El estado se lee del contrato: `FUNDED`, `DELIVERED`, `DISPUTED`, `RELEASED` o `REFUNDED`. Los botones se bloquean según el estado para evitar pasos inválidos.

### Correr la demo

```powershell
cd C:\Users\petra\videodanza-nft\8004\entropia-escrow

# Dependencias
npm install

# Pruebas directas del contrato
.venv\Scripts\python.exe -m pytest tests/direct -v

# Linter
$env:PYTHONIOENCODING='utf-8'; .venv\Scripts\genvm-lint.exe check contracts\composition_escrow.py
# Si falla con "Failed to load SDK ... runners/...tar not found",
# el lint de 3 checks ya pasó; falta el bundle local del runner.

# Servidor del demo
node scripts/serve-demo.mjs
```

Abre `http://localhost:4317`.

Si no existe `.secrets/demo-keys.json`, corre primero `node scripts/demo.mjs` para generar las llaves de Studio. Ese archivo está en `.gitignore`: no se commitea.

Para usar otro contrato:

```powershell
$env:CONTRACT_ADDRESS = "0x..."
node scripts/serve-demo.mjs
```

### Qué hace el servidor

- `GET /api/state` lee el contrato y las últimas órdenes.
- `POST /api/create` crea una orden pagable.
- `POST /api/deliver` registra la entrega.
- `POST /api/dispute` abre la disputa.
- `POST /api/resolve` ejecuta el juicio.
- El servidor serializa las escrituras para no mandar dos transacciones al mismo tiempo.

El servidor usa `genlayer-js` legacy `1.1.8` porque Studio no soporta `sim_getFeeConfig`. Para Bradbury Phase 2, el repo ya tiene el flujo con `genlayer-js` `2.0.0-rc.2` y fees.

## Qué se probó

En Studio, el contrato acumula tres órdenes de prueba:

- `ord-0`: entrega que sí cumplía el brief, veredicto `release`.
- `ord-1`: `example.com`, veredicto `refund`.
- `ord-2`: `example.com`, veredicto `refund` desde el frontend nuevo.

La última corrida se hizo completa desde la página: crear, entregar, disputar y resolver. El contrato pasó de `FUNDED` a `DELIVERED`, luego a `DISPUTED` y terminó en `REFUNDED` con razón que cita el contenido de `example.com` y marca los requisitos como NOT MET.

Contrato de Studio:

```text
0x6f482A969e605e824a73fC0Fd9225490e90Dc307
```

Explorer:

```text
https://explorer-studio.genlayer.com/address/0x6f482A969e605e824a73fC0Fd9225490e90Dc307
```

## Límites del MVP

- Un solo vendedor y pagos todo o nada.
- El comprador puede disputar cualquier entrega; no hay ventana de apelación propia.
- El depósito y el pago son en GEN nativo, no en USDC.
- No hay reembolsos parciales.
- La sonda web funciona mejor con páginas de texto; no valida video, imagen o audio.
- El frontend es una demo local. Para producción hace falta wallet, backend con llaves protegidas y límites de gasto.

## Qué sigue

1. Desplegar el escrow en Bradbury Phase 2 cuando el faucet tenga GEN.
2. Convertirlo en una oferta de Entropy para comisiones de arte.
3. Agregar una ventana de disputa y un reembolso parcial.
4. Probar entregables multimodales con un verificador que mire imagen o video.
5. Publicar el proyecto en el Project Explorer de GenLayer con el demo web y las pruebas.

La idea de fondo es simple: si una IA puede leer y juzgar una entrega, el contrato puede resolver lo que antes dependía de una persona de confianza.
