-- El phone_number_id de Meta debe resolver exactamente un canal de plataforma.
-- La unicidad evita que una función segura devuelva dos tenants posibles.

set role commerce_owner;

create unique index channels_provider_external_account_uidx
  on app.channels (provider, external_account_id);

reset role;
