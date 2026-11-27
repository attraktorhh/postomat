<?php
// Gives user "postomat" an application password with the KNOWN value
// "dev0 dev0 dev0 dev0 dev0 dev0". WP only generates random ones, so we create
// one and then replace its stored hash with the hash of the known value,
// using the same hashing as core (wp_fast_hash in WP >= 6.8, phpass before).
const POSTOMAT_APP_NAME = 'postomat-dev';
const POSTOMAT_APP_PASSWORD = 'dev0dev0dev0dev0dev0dev0';

$user = get_user_by('login', 'postomat');
if (!$user) { WP_CLI::error('user postomat missing'); }
if (!wp_is_application_passwords_available_for_user($user)) {
  WP_CLI::error('application passwords not available (is WP_ENVIRONMENT_TYPE=local set?)');
}

function postomat_hash_app_password($plain) {
  if (method_exists('WP_Application_Passwords', 'hash_password')) {
    $m = new ReflectionMethod('WP_Application_Passwords', 'hash_password');
    $m->setAccessible(true);
    return $m->invoke(null, $plain);
  }
  return function_exists('wp_fast_hash') ? wp_fast_hash($plain) : wp_hash_password($plain);
}

function postomat_verify($hash) {
  if (function_exists('wp_verify_fast_hash') && str_starts_with($hash, '$generic$')) {
    return wp_verify_fast_hash(POSTOMAT_APP_PASSWORD, $hash);
  }
  return wp_check_password(POSTOMAT_APP_PASSWORD, $hash);
}

$items = WP_Application_Passwords::get_user_application_passwords($user->ID);
$found = null;
foreach ($items as $item) {
  if ($item['name'] === POSTOMAT_APP_NAME) { $found = $item; break; }
}

if ($found && postomat_verify($found['password'])) {
  WP_CLI::success('application password for postomat already set');
  return;
}
if (!$found) {
  $created = WP_Application_Passwords::create_new_application_password($user->ID, ['name' => POSTOMAT_APP_NAME]);
  if (is_wp_error($created)) { WP_CLI::error($created->get_error_message()); }
  $found = $created[1];
}

$items = WP_Application_Passwords::get_user_application_passwords($user->ID);
foreach ($items as &$item) {
  if ($item['uuid'] === $found['uuid']) { $item['password'] = postomat_hash_app_password(POSTOMAT_APP_PASSWORD); }
}
unset($item);
update_user_meta($user->ID, WP_Application_Passwords::USERMETA_KEY_APPLICATION_PASSWORDS, $items);
WP_CLI::success('application password for postomat set to the known dev value');
