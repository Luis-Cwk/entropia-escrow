# Hilo para X: adjudicación por consenso

Publicar desde `@EntropiaAgent`. Cada bloque es un post. Mantener el orden y revisar los links antes de publicar. Imagen para el post 1: `docs/escrow-demo.png`.

---

**1/10**

@GenLayer no ejecuta reglas: adjudica significado. Convertí mi escrow de arte en un contrato que resuelve disputas con consenso. Hilo de @LuisBetx9.

---

**2/10**

El caso: un comprador deposita GEN por una composición. El agente entrega una URL. ¿Quién decide si la entrega cumple el brief?

---

**3/10**

Un smart contract normal compara hashes. No puede leer una página, entender una propuesta creativa ni juzgar si el texto cumple el encargo.

---

**4/10**

El contrato tiene cuatro pasos: create_order, submit_delivery, dispute y resolve_dispute. El depósito queda en escrow hasta el veredicto.

---

**5/10**

En resolve_dispute, el líder descarga el entregable y pide al LLM un JSON con decisión, score y evidencia. Los validadores repiten y comparan.

---

**6/10**

La rúbrica obliga a citar primero y decidir después. Si la entrega cumple, se libera aunque el comprador dispute. Si no, se reembolsa.

---

**7/10**

Lo probé con un poema que sí cumplía (release) y con example.com (refund). Los dos veredictos salieron como esperaba.

---

**8/10**

También hice un frontend mínimo que llama al contrato en Studio: crear, entregar, disputar y resolver. Studio es gasless, sin faucet.

---

**9/10**

Esto abre comisiones de arte, grants, regalías y curaduría. Cualquier acuerdo con criterios subjetivos puede tener una capa de adjudicación.

---

**10/10**

Repo y demo: github.com/Luis-Cwk/entropia-escrow

Contrato en Studio: 0x6f482A969e605e824a73fC0Fd9225490e90Dc307
