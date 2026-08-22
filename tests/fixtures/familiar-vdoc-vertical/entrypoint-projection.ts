import {
  defineEphemeral as defineUmbrellaEphemeral,
  ephemeral as umbrellaEphemeral,
} from "@expo/snapback/server";
import {
  defineEphemeral as defineGeneratedEphemeral,
  ephemeral as generatedEphemeral,
  v,
} from "./generated/server";

export const umbrellaDeclaration = defineUmbrellaEphemeral({
  typing: umbrellaEphemeral.collection({
    scope: { roomId: v.string() },
    value: v.object({ active: v.boolean() }),
  }),
});

export const generatedDeclaration = defineGeneratedEphemeral({
  typing: generatedEphemeral.collection({
    scope: { roomId: v.string() },
    value: v.object({ active: v.boolean() }),
  }),
});
