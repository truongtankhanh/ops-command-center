#!/bin/sh
# Generates the broker's accounts and ACL, then starts Mosquitto (ADR-0019, "Broker access").
#
# Demo only: the passwords are the stack's demo values (ADR-0006). One account for the API, which
# may subscribe to every asset and publish nothing, and one per asset of the simulator's
# catalogue (username = asset code), each of which may publish only under its own topic. Rules are
# written per user, never as a `pattern`: a pattern applies to every account, including the API's.
set -eu

CATALOGUE=/mosquitto/catalogue.json
PASSWD=/tmp/mosquitto-passwd
ACL=/tmp/mosquitto-acl

fail() {
  echo "mosquitto entrypoint: $1" >&2
  exit 1
}

[ -n "${MQTT_USERNAME:-}" ] || fail "MQTT_USERNAME must not be empty"
[ -n "${MQTT_PASSWORD:-}" ] || fail "MQTT_PASSWORD must not be empty"
[ -n "${MQTT_DEVICE_PASSWORD:-}" ] || fail "MQTT_DEVICE_PASSWORD must not be empty"
[ -r "$CATALOGUE" ] || fail "$CATALOGUE is not readable"

# The catalogue is written with one `"code"` per asset and one `"site"`, each on its own line, and
# a spec in the API keeps it so (telemetry-sim-catalogue.spec.ts): sed is enough, no jq.
site=$(sed -n 's/^[[:space:]]*"site":[[:space:]]*"\([A-Za-z0-9_-]*\)".*/\1/p' "$CATALOGUE")
codes=$(sed -n 's/^[[:space:]]*"code":[[:space:]]*"\([A-Za-z0-9_-]*\)".*/\1/p' "$CATALOGUE")
[ -n "$site" ] || fail "no site in $CATALOGUE"
[ -n "$codes" ] || fail "no asset code in $CATALOGUE"

rm -f "$PASSWD" "$ACL"
mosquitto_passwd -b -c "$PASSWD" "$MQTT_USERNAME" "$MQTT_PASSWORD"
printf 'user %s\ntopic read occ/+/asset/+/#\n\n' "$MQTT_USERNAME" > "$ACL"

count=0
for code in $codes; do
  mosquitto_passwd -b "$PASSWD" "$code" "$MQTT_DEVICE_PASSWORD"
  printf 'user %s\ntopic write occ/%s/asset/%s/#\n\n' "$code" "$site" "$code" >> "$ACL"
  count=$((count + 1))
done

# Mosquitto refuses files that are not its own once it drops privileges.
chown mosquitto:mosquitto "$PASSWD" "$ACL"
chmod 0600 "$PASSWD" "$ACL"
echo "mosquitto entrypoint: 1 API account and $count device accounts for site $site"

# The image's own entrypoint fixes the data directory's owner, then runs the command.
exec /docker-entrypoint.sh /usr/sbin/mosquitto -c /mosquitto/config/mosquitto.conf
