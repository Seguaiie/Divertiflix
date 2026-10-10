using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Divertiflix.Infrastructure.Migrations
{
    /// <inheritdoc />
    public partial class BackfillUserSource : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            // La migration AdAndAudiobookshelfPrep a donné une source vide aux comptes déjà présents : ce sont des comptes locaux
            // (la synchronisation de l'annuaire ne les reconnaissait pas et échouait sur le doublon de courriel).
            migrationBuilder.Sql("""UPDATE "Users" SET "Source" = 'Local' WHERE "Source" = '';""");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            // Rien à défaire : une source vide n'avait aucun sens.
        }
    }
}
