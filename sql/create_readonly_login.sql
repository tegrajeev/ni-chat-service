-- Read-only login for the NI chatbot service (run as a DBA).
-- The chatbot can SELECT only the tables listed below. It gets no db_datareader role,
-- so tables added later are NOT readable until you grant them here.
-- Replace the password, and store it only in the service's .env.local / Key Vault.
--
-- Azure SQL Database: USE is not supported and logins live in master. Skip the first block and run,
-- connected to NI_hackathon_data:  CREATE USER [ni_chatbot_ro] WITH PASSWORD = N'<CHANGE-ME>';

USE [master];
IF NOT EXISTS (SELECT 1 FROM sys.server_principals WHERE name = N'ni_chatbot_ro')
    CREATE LOGIN [ni_chatbot_ro] WITH PASSWORD = N'<CHANGE-ME-strong-password>', CHECK_POLICY = ON;
GO

USE [NI_hackathon_data];
IF NOT EXISTS (SELECT 1 FROM sys.database_principals WHERE name = N'ni_chatbot_ro')
    CREATE USER [ni_chatbot_ro] FOR LOGIN [ni_chatbot_ro] WITH DEFAULT_SCHEMA = [dbo];
GO

-- Allowed tables (skipped automatically if a table does not exist in this database)
IF OBJECT_ID(N'dbo.PlanDetails', N'U') IS NOT NULL OR OBJECT_ID(N'dbo.PlanDetails', N'V') IS NOT NULL GRANT SELECT ON [dbo].[PlanDetails] TO [ni_chatbot_ro];
IF OBJECT_ID(N'dbo.ProviderDetails', N'U') IS NOT NULL OR OBJECT_ID(N'dbo.ProviderDetails', N'V') IS NOT NULL GRANT SELECT ON [dbo].[ProviderDetails] TO [ni_chatbot_ro];
IF OBJECT_ID(N'dbo.Speciality', N'U') IS NOT NULL OR OBJECT_ID(N'dbo.Speciality', N'V') IS NOT NULL GRANT SELECT ON [dbo].[Speciality] TO [ni_chatbot_ro];
IF OBJECT_ID(N'dbo.LanguageProviderMapping', N'U') IS NOT NULL OR OBJECT_ID(N'dbo.LanguageProviderMapping', N'V') IS NOT NULL GRANT SELECT ON [dbo].[LanguageProviderMapping] TO [ni_chatbot_ro];
IF OBJECT_ID(N'dbo.ProviderScoreDetails', N'U') IS NOT NULL OR OBJECT_ID(N'dbo.ProviderScoreDetails', N'V') IS NOT NULL GRANT SELECT ON [dbo].[ProviderScoreDetails] TO [ni_chatbot_ro];
IF OBJECT_ID(N'dbo.LanguageGeographyMapping', N'U') IS NOT NULL OR OBJECT_ID(N'dbo.LanguageGeographyMapping', N'V') IS NOT NULL GRANT SELECT ON [dbo].[LanguageGeographyMapping] TO [ni_chatbot_ro];
IF OBJECT_ID(N'dbo.ProviderLocation', N'U') IS NOT NULL OR OBJECT_ID(N'dbo.ProviderLocation', N'V') IS NOT NULL GRANT SELECT ON [dbo].[ProviderLocation] TO [ni_chatbot_ro];
IF OBJECT_ID(N'dbo.HospitalDetails', N'U') IS NOT NULL OR OBJECT_ID(N'dbo.HospitalDetails', N'V') IS NOT NULL GRANT SELECT ON [dbo].[HospitalDetails] TO [ni_chatbot_ro];
IF OBJECT_ID(N'dbo.ParentOrganization', N'U') IS NOT NULL OR OBJECT_ID(N'dbo.ParentOrganization', N'V') IS NOT NULL GRANT SELECT ON [dbo].[ParentOrganization] TO [ni_chatbot_ro];
IF OBJECT_ID(N'dbo.HospitalScores', N'U') IS NOT NULL OR OBJECT_ID(N'dbo.HospitalScores', N'V') IS NOT NULL GRANT SELECT ON [dbo].[HospitalScores] TO [ni_chatbot_ro];
IF OBJECT_ID(N'dbo.GroupDetails', N'U') IS NOT NULL OR OBJECT_ID(N'dbo.GroupDetails', N'V') IS NOT NULL GRANT SELECT ON [dbo].[GroupDetails] TO [ni_chatbot_ro];
IF OBJECT_ID(N'dbo.State', N'U') IS NOT NULL OR OBJECT_ID(N'dbo.State', N'V') IS NOT NULL GRANT SELECT ON [dbo].[State] TO [ni_chatbot_ro];
IF OBJECT_ID(N'dbo.Network', N'U') IS NOT NULL OR OBJECT_ID(N'dbo.Network', N'V') IS NOT NULL GRANT SELECT ON [dbo].[Network] TO [ni_chatbot_ro];
IF OBJECT_ID(N'dbo.County', N'U') IS NOT NULL OR OBJECT_ID(N'dbo.County', N'V') IS NOT NULL GRANT SELECT ON [dbo].[County] TO [ni_chatbot_ro];
IF OBJECT_ID(N'dbo.EnrollmentDetails', N'U') IS NOT NULL OR OBJECT_ID(N'dbo.EnrollmentDetails', N'V') IS NOT NULL GRANT SELECT ON [dbo].[EnrollmentDetails] TO [ni_chatbot_ro];
IF OBJECT_ID(N'dbo.PlanNetworkMapping', N'U') IS NOT NULL OR OBJECT_ID(N'dbo.PlanNetworkMapping', N'V') IS NOT NULL GRANT SELECT ON [dbo].[PlanNetworkMapping] TO [ni_chatbot_ro];
IF OBJECT_ID(N'dbo.NetworkHospitalMapping', N'U') IS NOT NULL OR OBJECT_ID(N'dbo.NetworkHospitalMapping', N'V') IS NOT NULL GRANT SELECT ON [dbo].[NetworkHospitalMapping] TO [ni_chatbot_ro];
IF OBJECT_ID(N'dbo.NetworkProviderMapping', N'U') IS NOT NULL OR OBJECT_ID(N'dbo.NetworkProviderMapping', N'V') IS NOT NULL GRANT SELECT ON [dbo].[NetworkProviderMapping] TO [ni_chatbot_ro];
IF OBJECT_ID(N'dbo.ProviderGroupAffiliation', N'U') IS NOT NULL OR OBJECT_ID(N'dbo.ProviderGroupAffiliation', N'V') IS NOT NULL GRANT SELECT ON [dbo].[ProviderGroupAffiliation] TO [ni_chatbot_ro];
IF OBJECT_ID(N'dbo.ProviderSpecialityMapping', N'U') IS NOT NULL OR OBJECT_ID(N'dbo.ProviderSpecialityMapping', N'V') IS NOT NULL GRANT SELECT ON [dbo].[ProviderSpecialityMapping] TO [ni_chatbot_ro];
IF OBJECT_ID(N'dbo.SpecialityCodeHSDMapping', N'U') IS NOT NULL OR OBJECT_ID(N'dbo.SpecialityCodeHSDMapping', N'V') IS NOT NULL GRANT SELECT ON [dbo].[SpecialityCodeHSDMapping] TO [ni_chatbot_ro];
IF OBJECT_ID(N'dbo.ProviderHospitalAffiliation', N'U') IS NOT NULL OR OBJECT_ID(N'dbo.ProviderHospitalAffiliation', N'V') IS NOT NULL GRANT SELECT ON [dbo].[ProviderHospitalAffiliation] TO [ni_chatbot_ro];
IF OBJECT_ID(N'dbo.MilesIndividual_10', N'U') IS NOT NULL OR OBJECT_ID(N'dbo.MilesIndividual_10', N'V') IS NOT NULL GRANT SELECT ON [dbo].[MilesIndividual_10] TO [ni_chatbot_ro];
IF OBJECT_ID(N'dbo.MilesHospital_10', N'U') IS NOT NULL OR OBJECT_ID(N'dbo.MilesHospital_10', N'V') IS NOT NULL GRANT SELECT ON [dbo].[MilesHospital_10] TO [ni_chatbot_ro];
IF OBJECT_ID(N'dbo.NetworkCountbyFIPS', N'U') IS NOT NULL OR OBJECT_ID(N'dbo.NetworkCountbyFIPS', N'V') IS NOT NULL GRANT SELECT ON [dbo].[NetworkCountbyFIPS] TO [ni_chatbot_ro];
IF OBJECT_ID(N'dbo.MilesHospital_30', N'U') IS NOT NULL OR OBJECT_ID(N'dbo.MilesHospital_30', N'V') IS NOT NULL GRANT SELECT ON [dbo].[MilesHospital_30] TO [ni_chatbot_ro];
IF OBJECT_ID(N'dbo.NetworkCountbyZIP', N'U') IS NOT NULL OR OBJECT_ID(N'dbo.NetworkCountbyZIP', N'V') IS NOT NULL GRANT SELECT ON [dbo].[NetworkCountbyZIP] TO [ni_chatbot_ro];
IF OBJECT_ID(N'dbo.MilesIndividual_30', N'U') IS NOT NULL OR OBJECT_ID(N'dbo.MilesIndividual_30', N'V') IS NOT NULL GRANT SELECT ON [dbo].[MilesIndividual_30] TO [ni_chatbot_ro];
IF OBJECT_ID(N'dbo.MilesHospital_60', N'U') IS NOT NULL OR OBJECT_ID(N'dbo.MilesHospital_60', N'V') IS NOT NULL GRANT SELECT ON [dbo].[MilesHospital_60] TO [ni_chatbot_ro];
IF OBJECT_ID(N'dbo.MilesIndividual_60', N'U') IS NOT NULL OR OBJECT_ID(N'dbo.MilesIndividual_60', N'V') IS NOT NULL GRANT SELECT ON [dbo].[MilesIndividual_60] TO [ni_chatbot_ro];
IF OBJECT_ID(N'dbo.ProviderAddressCount', N'U') IS NOT NULL OR OBJECT_ID(N'dbo.ProviderAddressCount', N'V') IS NOT NULL GRANT SELECT ON [dbo].[ProviderAddressCount] TO [ni_chatbot_ro];
IF OBJECT_ID(N'dbo.GeographyPlanFilters', N'U') IS NOT NULL OR OBJECT_ID(N'dbo.GeographyPlanFilters', N'V') IS NOT NULL GRANT SELECT ON [dbo].[GeographyPlanFilters] TO [ni_chatbot_ro];
IF OBJECT_ID(N'dbo.Market', N'U') IS NOT NULL OR OBJECT_ID(N'dbo.Market', N'V') IS NOT NULL GRANT SELECT ON [dbo].[Market] TO [ni_chatbot_ro];
IF OBJECT_ID(N'dbo.SubMarket', N'U') IS NOT NULL OR OBJECT_ID(N'dbo.SubMarket', N'V') IS NOT NULL GRANT SELECT ON [dbo].[SubMarket] TO [ni_chatbot_ro];
IF OBJECT_ID(N'dbo.DataFlagInfo', N'U') IS NOT NULL OR OBJECT_ID(N'dbo.DataFlagInfo', N'V') IS NOT NULL GRANT SELECT ON [dbo].[DataFlagInfo] TO [ni_chatbot_ro];
IF OBJECT_ID(N'dbo.PlanType', N'U') IS NOT NULL OR OBJECT_ID(N'dbo.PlanType', N'V') IS NOT NULL GRANT SELECT ON [dbo].[PlanType] TO [ni_chatbot_ro];
IF OBJECT_ID(N'dbo.PlanGeographyMapping', N'U') IS NOT NULL OR OBJECT_ID(N'dbo.PlanGeographyMapping', N'V') IS NOT NULL GRANT SELECT ON [dbo].[PlanGeographyMapping] TO [ni_chatbot_ro];
IF OBJECT_ID(N'dbo.PlanCategory', N'U') IS NOT NULL OR OBJECT_ID(N'dbo.PlanCategory', N'V') IS NOT NULL GRANT SELECT ON [dbo].[PlanCategory] TO [ni_chatbot_ro];
IF OBJECT_ID(N'dbo.FootPrint', N'U') IS NOT NULL OR OBJECT_ID(N'dbo.FootPrint', N'V') IS NOT NULL GRANT SELECT ON [dbo].[FootPrint] TO [ni_chatbot_ro];
IF OBJECT_ID(N'dbo.SpecialitySourceFlagInfo', N'U') IS NOT NULL OR OBJECT_ID(N'dbo.SpecialitySourceFlagInfo', N'V') IS NOT NULL GRANT SELECT ON [dbo].[SpecialitySourceFlagInfo] TO [ni_chatbot_ro];
IF OBJECT_ID(N'dbo.NPIQuickFilterMapping', N'U') IS NOT NULL OR OBJECT_ID(N'dbo.NPIQuickFilterMapping', N'V') IS NOT NULL GRANT SELECT ON [dbo].[NPIQuickFilterMapping] TO [ni_chatbot_ro];

-- Client/tenant configuration: explicitly denied
IF OBJECT_ID(N'dbo.ClientNetworkMapping', N'U') IS NOT NULL DENY SELECT ON [dbo].[ClientNetworkMapping] TO [ni_chatbot_ro];
IF OBJECT_ID(N'dbo.ClientDetails', N'U') IS NOT NULL DENY SELECT ON [dbo].[ClientDetails] TO [ni_chatbot_ro];
IF OBJECT_ID(N'dbo.ExclusiveParentOrgMapping', N'U') IS NOT NULL DENY SELECT ON [dbo].[ExclusiveParentOrgMapping] TO [ni_chatbot_ro];
IF OBJECT_ID(N'dbo.ClientDataFlagMapping', N'U') IS NOT NULL DENY SELECT ON [dbo].[ClientDataFlagMapping] TO [ni_chatbot_ro];
IF OBJECT_ID(N'dbo.NPIClientFIPSConfig', N'U') IS NOT NULL DENY SELECT ON [dbo].[NPIClientFIPSConfig] TO [ni_chatbot_ro];
IF OBJECT_ID(N'dbo.ClientSpecialitySourceFlagMapping', N'U') IS NOT NULL DENY SELECT ON [dbo].[ClientSpecialitySourceFlagMapping] TO [ni_chatbot_ro];
IF OBJECT_ID(N'dbo.LobbyUserConfig', N'U') IS NOT NULL DENY SELECT ON [dbo].[LobbyUserConfig] TO [ni_chatbot_ro];

-- No VIEW DEFINITION needed: INFORMATION_SCHEMA.COLUMNS already shows columns of tables the user can SELECT.
GO

-- Check: this must list only the allowed tables
-- EXECUTE AS USER = 'ni_chatbot_ro'; SELECT TABLE_NAME FROM INFORMATION_SCHEMA.TABLES ORDER BY 1; REVERT;
