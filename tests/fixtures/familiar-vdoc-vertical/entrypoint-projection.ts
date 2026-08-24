import {
  action as umbrellaAction,
  allow as umbrellaAllow,
  defineAssetUpload as defineUmbrellaAssetUpload,
  defineAuth as defineUmbrellaAuth,
  defineEphemeral as defineUmbrellaEphemeral,
  defineSchema as defineUmbrellaSchema,
  defineTable as defineUmbrellaTable,
  ephemeral as umbrellaEphemeral,
  membershipResource as umbrellaMembershipResource,
  mutation as umbrellaMutation,
  query as umbrellaQuery,
} from "@expo/snapback/server";
import { v as umbrellaV } from "@expo/snapback/values";
import {
  action as generatedAction,
  allow as generatedAllow,
  defineAssetUpload as defineGeneratedAssetUpload,
  defineAuth as defineGeneratedAuth,
  defineEphemeral as defineGeneratedEphemeral,
  defineSchema as defineGeneratedSchema,
  defineTable as defineGeneratedTable,
  ephemeral as generatedEphemeral,
  membershipResource as generatedMembershipResource,
  mutation as generatedMutation,
  query as generatedQuery,
  v,
} from "./generated/server";

void [
  umbrellaAction,
  umbrellaAllow,
  defineUmbrellaAssetUpload,
  defineUmbrellaAuth,
  defineUmbrellaSchema,
  defineUmbrellaTable,
  umbrellaMembershipResource,
  umbrellaMutation,
  umbrellaQuery,
  umbrellaV,
  generatedAction,
  generatedAllow,
  defineGeneratedAssetUpload,
  defineGeneratedAuth,
  defineGeneratedSchema,
  defineGeneratedTable,
  generatedMembershipResource,
  generatedMutation,
  generatedQuery,
];

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
