import { msg, t } from "../../src/i18n/index.js";

t("en", "doctor.configValid");
t("en", "doctor.adaptersEnabled", { count: 1 });
msg("doctor.adaptersEnabled", { count: 1 });

// @ts-expect-error required ICU values are missing
t("en", "doctor.adaptersEnabled");
// @ts-expect-error the ICU argument name is checked
t("en", "doctor.adaptersEnabled", { total: 1 });
// @ts-expect-error messages without arguments reject values
t("en", "doctor.configValid", { count: 1 });
// @ts-expect-error message keys are generated from the canonical catalog
msg("doctor.not-declared");
