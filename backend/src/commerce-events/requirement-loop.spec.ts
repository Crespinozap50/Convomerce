import {
  extractPendingRequirementValues,
  isAddressDetailedEnough,
  nextPendingStep,
  PendingRequirement,
  resolveBooleanRequirementValue,
  validateRequirementValue,
} from "./requirement-loop";

const requirement = (
  overrides: Partial<PendingRequirement> = {},
): PendingRequirement => ({
  id: "req-1",
  fieldKey: "vehicle_type",
  dataType: "text",
  isRequired: true,
  displayOrder: 0,
  validationRule: {},
  sensitivity: "none",
  requiresConfirmation: false,
  reuseFromContactMemory: false,
  label: "Label",
  helpText: null,
  options: [],
  ...overrides,
});

describe("nextPendingStep", () => {
  it("returns null for an empty list", () => {
    expect(nextPendingStep([], [])).toBeNull();
  });

  it("returns the first requirement when nothing is filled yet", () => {
    const first = requirement({ fieldKey: "name", displayOrder: 0 });
    const second = requirement({ fieldKey: "delivery_address", displayOrder: 10 });
    expect(nextPendingStep([first, second], [])).toBe(first);
  });

  it("skips a requirement already present in alreadyFilledFieldKeys", () => {
    const first = requirement({ fieldKey: "name", displayOrder: 0 });
    const second = requirement({ fieldKey: "delivery_address", displayOrder: 10 });
    expect(nextPendingStep([first, second], ["name"])).toBe(second);
  });

  it("returns null once every requirement is filled", () => {
    const first = requirement({ fieldKey: "name" });
    expect(nextPendingStep([first], ["name"])).toBeNull();
  });
});

describe("validateRequirementValue", () => {
  it("rejects text shorter than the configured min_length", () => {
    const field = requirement({ dataType: "text", validationRule: { min_length: 5 } });
    expect(validateRequirementValue("ab", field)).toEqual({ valid: false });
    expect(validateRequirementValue("abcdef", field)).toEqual({
      valid: true,
      value: "abcdef",
    });
  });

  it("validates a number against min/max", () => {
    const field = requirement({ dataType: "number", validationRule: { min: 1, max: 10 } });
    expect(validateRequirementValue("15", field)).toEqual({ valid: false });
    expect(validateRequirementValue("not a number", field)).toEqual({ valid: false });
    expect(validateRequirementValue("7", field)).toEqual({ valid: true, value: "7" });
  });

  it("matches a select option by index or by value/label", () => {
    const field = requirement({
      dataType: "select",
      options: [
        { value: "car", label: "Carro" },
        { value: "motorcycle", label: "Moto" },
      ],
    });
    expect(validateRequirementValue("1", field)).toEqual({ valid: true, value: "car" });
    expect(validateRequirementValue("moto", field)).toEqual({
      valid: true,
      value: "motorcycle",
    });
    expect(validateRequirementValue("bicycle", field)).toEqual({ valid: false });
  });

  it("matches a select option embedded in a longer natural sentence, not just an exact reply (regression)", () => {
    // Before this fix, a targeted single-field prompt only accepted an
    // exact match to the option's value/label/index — "moto" worked but a
    // natural sentence mentioning it did not, unlike the fuzzy matching
    // extractPendingRequirementValues already used for opportunistic
    // multi-field extraction. Both now share the same matching logic.
    const field = requirement({
      dataType: "select",
      options: [
        { value: "car", label: "Carro" },
        { value: "motorcycle", label: "Moto" },
      ],
    });
    expect(
      validateRequirementValue("Prefiero la moto, es más rápida", field),
    ).toEqual({ valid: true, value: "motorcycle" });
    expect(
      validateRequirementValue("no se, tal vez carro o moto", field),
    ).toEqual({ valid: false });
  });

  it("delegates address validation to isAddressDetailedEnough", () => {
    const field = requirement({ dataType: "address", validationRule: {} });
    expect(validateRequirementValue("Robledo", field)).toEqual({ valid: false });
    expect(validateRequirementValue("Calle 65 # 88-20, portería azul", field)).toEqual({
      valid: true,
      value: "Calle 65 # 88-20, portería azul",
    });
  });

  it("always rejects boolean fields, which are resolved from understanding entities instead", () => {
    const field = requirement({ dataType: "boolean" });
    expect(validateRequirementValue("yes", field)).toEqual({ valid: false });
  });
});

describe("resolveBooleanRequirementValue", () => {
  it("reads the affirmative/negative entity and returns null otherwise", () => {
    expect(resolveBooleanRequirementValue({ response: "affirmative" })).toBe("true");
    expect(resolveBooleanRequirementValue({ response: "negative" })).toBe("false");
    expect(resolveBooleanRequirementValue({})).toBeNull();
  });
});

describe("extractPendingRequirementValues", () => {
  const vehicleType = requirement({
    fieldKey: "vehicle_type",
    dataType: "select",
    options: [
      { value: "car", label: "Carro" },
      { value: "motorcycle", label: "Moto" },
      { value: "truck", label: "Camioneta" },
    ],
  });
  const wantsWax = requirement({ fieldKey: "wants_wax", dataType: "boolean" });
  const notes = requirement({ fieldKey: "notes", dataType: "text" });

  it("fills a select and a boolean field from one message", () => {
    const result = extractPendingRequirementValues(
      "lavado premium para camioneta, sin cera",
      { response: "negative" },
      [vehicleType, wantsWax],
    );
    expect(result).toEqual(
      expect.arrayContaining([
        { fieldKey: "vehicle_type", value: "truck" },
        { fieldKey: "wants_wax", value: "false" },
      ]),
    );
    expect(result).toHaveLength(2);
  });

  it("leaves a select field unresolved when two options match ambiguously", () => {
    const result = extractPendingRequirementValues(
      "no se, tal vez carro o moto",
      {},
      [vehicleType],
    );
    expect(result).toEqual([]);
  });

  it("leaves two simultaneous boolean fields unresolved (cannot tell which one a yes/no answers)", () => {
    const otherBoolean = requirement({ fieldKey: "wants_insurance", dataType: "boolean" });
    const result = extractPendingRequirementValues(
      "si",
      { response: "affirmative" },
      [wantsWax, otherBoolean],
    );
    expect(result).toEqual([]);
  });

  it("leaves a number field unresolved when the message has two number tokens", () => {
    const tireCount = requirement({ fieldKey: "tire_count", dataType: "number" });
    expect(
      extractPendingRequirementValues("tengo 4 o 6 llantas", {}, [tireCount]),
    ).toEqual([]);
    expect(
      extractPendingRequirementValues("tengo 4 llantas", {}, [tireCount]),
    ).toEqual([{ fieldKey: "tire_count", value: "4" }]);
  });

  it("never extracts text/address/phone fields, even as the sole pending field", () => {
    expect(
      extractPendingRequirementValues("cualquier cosa que escriba el cliente", {}, [notes]),
    ).toEqual([]);
  });

  it("does not false-positive a short option value inside an unrelated word", () => {
    const yesNo = requirement({
      fieldKey: "confirmation_code",
      dataType: "select",
      options: [
        { value: "si", label: "Sí" },
        { value: "no", label: "No" },
      ],
    });
    // "asignado" contains "si" as a substring but not as a whole word.
    expect(
      extractPendingRequirementValues("ya quedó asignado", {}, [yesNo]),
    ).toEqual([]);
  });
});

describe("isAddressDetailedEnough", () => {
  it("defaults to the historical colombian_urban structure", () => {
    expect(isAddressDetailedEnough("Robledo")).toBe(false);
    expect(isAddressDetailedEnough("Calle 65 # 88-20, portería azul")).toBe(true);
  });

  it("accepts a plain numbered address under generic_numbered", () => {
    expect(
      isAddressDetailedEnough("123 Main St Apt 4", { structure_pattern: "generic_numbered" }),
    ).toBe(true);
  });

  it("accepts a colombian_urban address without a '#' when two number groups are present", () => {
    // Real WhatsApp users type "Calle 52F 90 sur 130" far more often than
    // "Calle 52F # 90-130" — the second number group is what actually
    // signals a complete street-number + door-number address.
    expect(isAddressDetailedEnough("Calle 52F 90 sur 130")).toBe(true);
  });

  it("still rejects a colombian_urban address with only one number group", () => {
    expect(isAddressDetailedEnough("Calle 33 Robledo")).toBe(false);
    expect(isAddressDetailedEnough("Calle 33 Robledo puerta azul")).toBe(false);
  });
});
