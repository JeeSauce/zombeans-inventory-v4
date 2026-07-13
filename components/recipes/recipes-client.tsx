"use client";

import Link from "next/link";
import { useActionState, useEffect, useState } from "react";
import { useFormStatus } from "react-dom";
import { BookOpen, Plus } from "lucide-react";
import { toast } from "sonner";
import { createRecipeAction, type RecipeActionState } from "@/app/(app)/recipes/actions";
import { formatHumanDate } from "@/lib/format";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

export interface RecipeOption {
  id: string;
  label: string;
}

export interface RecipeListRow {
  id: string;
  name: string;
  kind: "production" | "sale" | "modifier";
  outputName: string;
  outputSku: string;
  targetLabel: string;
  activeVersion: number | null;
  effectiveDate: string | null;
}

const selectClass =
  "border-input bg-background focus-visible:ring-ring flex h-9 w-full rounded-md border px-3 py-1 text-sm shadow-sm focus-visible:ring-1 focus-visible:outline-none";

function SubmitButton() {
  const { pending } = useFormStatus();
  return <Button disabled={pending}>{pending ? "Creating…" : "Create recipe"}</Button>;
}

function CreateRecipeDialog({
  productionItems,
  products,
  variants,
  modifierOptions,
}: {
  productionItems: RecipeOption[];
  products: RecipeOption[];
  variants: RecipeOption[];
  modifierOptions: RecipeOption[];
}) {
  const [open, setOpen] = useState(false);
  const [scope, setScope] = useState("production");
  const [state, action] = useActionState<RecipeActionState, FormData>(createRecipeAction, {});

  useEffect(() => {
    if (state.info) {
      toast.success(state.info);
      setOpen(false);
    }
  }, [state]);

  const targets =
    scope === "sale_product" ? products : scope === "sale_variant" ? variants : modifierOptions;

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button>
          <Plus className="size-4" /> New recipe
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Create recipe</DialogTitle>
        </DialogHeader>
        <form action={action} className="space-y-4">
          {state.error && (
            <Alert variant="destructive">
              <AlertDescription>{state.error}</AlertDescription>
            </Alert>
          )}
          <div className="space-y-2">
            <Label htmlFor="recipeName">Recipe name</Label>
            <Input id="recipeName" name="name" required maxLength={160} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="recipeScope">Recipe scope</Label>
            <select
              id="recipeScope"
              name="scope"
              className={selectClass}
              value={scope}
              onChange={(event) => setScope(event.target.value)}
            >
              <option value="production">Production output</option>
              <option value="sale_product">Product sale deduction</option>
              <option value="sale_variant">Variant sale deduction</option>
              <option value="modifier">Modifier deduction</option>
            </select>
          </div>
          {scope === "production" ? (
            <div className="space-y-2">
              <Label htmlFor="outputItemId">Produced item</Label>
              <select
                id="outputItemId"
                name="outputItemId"
                className={selectClass}
                required
                defaultValue=""
              >
                <option value="" disabled>
                  Choose an output…
                </option>
                {productionItems.map((option) => (
                  <option key={option.id} value={option.id}>
                    {option.label}
                  </option>
                ))}
              </select>
            </div>
          ) : (
            <div className="space-y-2">
              <Label htmlFor="targetId">Target</Label>
              <select
                id="targetId"
                name="targetId"
                className={selectClass}
                required
                defaultValue=""
              >
                <option value="" disabled>
                  Choose a target…
                </option>
                {targets.map((option) => (
                  <option key={option.id} value={option.id}>
                    {option.label}
                  </option>
                ))}
              </select>
              {targets.length === 0 && (
                <p className="text-muted-foreground text-xs">
                  No eligible targets exist in the catalog yet.
                </p>
              )}
            </div>
          )}
          <p className="text-muted-foreground text-xs">
            Create the recipe first, then add and activate a version from its detail page.
          </p>
          <div className="flex justify-end">
            <SubmitButton />
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function RecipesClient({
  recipes,
  canWrite,
  productionItems,
  products,
  variants,
  modifierOptions,
}: {
  recipes: RecipeListRow[];
  canWrite: boolean;
  productionItems: RecipeOption[];
  products: RecipeOption[];
  variants: RecipeOption[];
  modifierOptions: RecipeOption[];
}) {
  return (
    <div className="space-y-4">
      {canWrite && (
        <div className="flex justify-end">
          <CreateRecipeDialog
            productionItems={productionItems}
            products={products}
            variants={variants}
            modifierOptions={modifierOptions}
          />
        </div>
      )}
      {recipes.length === 0 ? (
        <div className="text-muted-foreground rounded-lg border border-dashed p-10 text-center">
          <BookOpen className="mx-auto mb-3 size-8 opacity-60" />
          No recipes yet.{" "}
          {canWrite
            ? "Create the first recipe to begin costing."
            : "Nothing has been published yet."}
        </div>
      ) : (
        <div className="rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Recipe</TableHead>
                <TableHead>Scope</TableHead>
                <TableHead>Output</TableHead>
                <TableHead>Target</TableHead>
                <TableHead>Active version</TableHead>
                <TableHead className="text-right">Open</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {recipes.map((recipe) => (
                <TableRow key={recipe.id}>
                  <TableCell className="font-medium">{recipe.name}</TableCell>
                  <TableCell>
                    <Badge variant="outline">{recipe.kind}</Badge>
                  </TableCell>
                  <TableCell>
                    <div>{recipe.outputName}</div>
                    <div className="font-data text-muted-foreground text-xs">
                      {recipe.outputSku}
                    </div>
                  </TableCell>
                  <TableCell>{recipe.targetLabel}</TableCell>
                  <TableCell>
                    {recipe.activeVersion ? (
                      <div>
                        <Badge>v{recipe.activeVersion}</Badge>
                        {recipe.effectiveDate && (
                          <div className="text-muted-foreground mt-1 text-xs">
                            {formatHumanDate(recipe.effectiveDate)}
                          </div>
                        )}
                      </div>
                    ) : (
                      <Badge variant="secondary">draft only</Badge>
                    )}
                  </TableCell>
                  <TableCell className="text-right">
                    <Button asChild size="sm" variant="outline">
                      <Link href={`/recipes/${recipe.id}`}>View</Link>
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}
