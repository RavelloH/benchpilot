#include <inttypes.h>
#include <stdio.h>

#include "esp_chip_info.h"
#include "esp_system.h"
#include "freertos/FreeRTOS.h"
#include "freertos/task.h"

void app_main(void) {
  esp_chip_info_t chip;
  esp_chip_info(&chip);
  printf("BENCHPILOT_ESP32S3_OK\n");
  printf("chip_cores=%d reset_reason=%d\n", chip.cores, esp_reset_reason());
  for (uint32_t count = 0;; count++) {
    printf("loop_count=%" PRIu32 "\n", count);
    vTaskDelay(pdMS_TO_TICKS(1000));
  }
}
