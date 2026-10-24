# Network-isolated Worker integration test. No secrets, sockets, or external services.
# workerd test -I <directory-containing-workerd-package> tests/runtime/config.capnp
using Workerd = import "/workerd/workerd.capnp";
const config :Workerd.Config = (
  services = [
    (name = "contact-runtime", worker = (
      compatibilityDate = "2026-10-22",
      modules = [
        (name = "test.mjs", esModule = embed "test.mjs"),
        (name = "contact-worker.mjs", esModule = embed "../../src/contact-worker.mjs")
      ],
      globalOutbound = "upstream-mock"
    )),
    (name = "upstream-mock", worker = (
      compatibilityDate = "2026-10-22",
      modules = [(name = "upstream.mjs", esModule = embed "upstream.mjs")],
      globalOutbound = "upstream-mock"
    ))
  ]
);
