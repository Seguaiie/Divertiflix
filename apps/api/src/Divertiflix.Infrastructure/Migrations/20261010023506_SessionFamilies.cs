using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Divertiflix.Infrastructure.Migrations
{
    /// <inheritdoc />
    public partial class SessionFamilies : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<Guid>(
                name: "FamilyId",
                table: "RefreshTokens",
                type: "uuid",
                nullable: false,
                defaultValue: new Guid("00000000-0000-0000-0000-000000000000"));

            migrationBuilder.AddColumn<DateTime>(
                name: "SessionExpiresAt",
                table: "RefreshTokens",
                type: "timestamp with time zone",
                nullable: false,
                defaultValue: new DateTime(1, 1, 1, 0, 0, 0, 0, DateTimeKind.Unspecified));

            // Jetons déjà émis : chacun forme sa propre famille (sinon ils partageraient tous l'identifiant nul et la détection de
            // rejeu couperait les sessions de tout le monde). Le début de leur session est inconnu : elle reçoit la durée absolue
            // par défaut (60 jours) à partir de maintenant, pour ne déconnecter personne au déploiement.
            migrationBuilder.Sql("""UPDATE "RefreshTokens" SET "FamilyId" = "Id", "SessionExpiresAt" = now() + interval '60 days';""");

            migrationBuilder.CreateIndex(
                name: "IX_RefreshTokens_FamilyId",
                table: "RefreshTokens",
                column: "FamilyId");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropIndex(
                name: "IX_RefreshTokens_FamilyId",
                table: "RefreshTokens");

            migrationBuilder.DropColumn(
                name: "FamilyId",
                table: "RefreshTokens");

            migrationBuilder.DropColumn(
                name: "SessionExpiresAt",
                table: "RefreshTokens");
        }
    }
}
