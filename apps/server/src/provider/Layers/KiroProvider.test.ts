import { assert, describe, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";

import { KiroSettings } from "@t3tools/contracts";
import { buildInitialKiroProviderSnapshot, parseKiroModelsJson } from "./KiroProvider.ts";

const decodeKiroSettings = Schema.decodeSync(KiroSettings);

describe("KiroProvider", () => {
  it("parses the JSON model catalog and preserves the advertised default", () => {
    const models = parseKiroModelsJson(
      JSON.stringify({
        models: [
          { model_name: "Auto", model_id: "auto", description: "Automatic" },
          { model_name: "Claude Sonnet 5", model_id: "claude-sonnet-5" },
          { model_name: "Duplicate", model_id: "claude-sonnet-5" },
        ],
        default_model: "auto",
      }),
    );

    assert.lengthOf(models, 2);
    assert.equal(models[0]?.slug, "auto");
    assert.isTrue(models[0]?.isDefault);
    assert.equal(models[1]?.slug, "claude-sonnet-5");
  });

  it("rejects malformed model output", () => {
    assert.deepStrictEqual(parseKiroModelsJson("not-json"), []);
    assert.deepStrictEqual(parseKiroModelsJson('{"models":[{"model_id":1}]}'), []);
  });

  it.effect("builds a disabled snapshot without probing the CLI", () =>
    Effect.gen(function* () {
      const snapshot = yield* buildInitialKiroProviderSnapshot(decodeKiroSettings({}));
      assert.isFalse(snapshot.enabled);
      assert.equal(snapshot.displayName, "Kiro");
      assert.equal(snapshot.status, "disabled");
      assert.equal(snapshot.models[0]?.slug, "auto");
    }),
  );
});
