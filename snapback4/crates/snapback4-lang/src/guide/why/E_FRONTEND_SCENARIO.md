# E_FRONTEND_SCENARIO

E_FRONTEND_SCENARIO: The frontend rendered but its application write scenario is missing.

The generated/adapted proof scaffold builds the frontend, signs in and checks rendered content, then refuses to claim a business write proof. Edit scripts/frontend-proof.mjs: click a real application form, assert its SDK write receipt and fresh rendered result, then replace this refusal. Keep the build and finally cleanup. A custom proof stays application-owned. Guide witness.
