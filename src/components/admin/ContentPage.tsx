import React from "react";
import { useBootstrap, useUpdateCategories, useUpdatePrefs } from "../../services/queries";
import { ContentTab } from "../settings/ContentTab";

export const ContentPage: React.FC = () => {
  const { data } = useBootstrap();
  const updateCategories = useUpdateCategories();
  const updatePrefs = useUpdatePrefs();

  const categories = data?.categories ?? [];
  const faviconApi = data?.prefs.faviconApi;
  const defaultCategoryId = data?.prefs.defaultCategoryId;

  const handleSetDefault = (id: string | null) => {
    if (!data?.prefs) return;
    const next = { ...data.prefs };
    if (id) next.defaultCategoryId = id;
    else delete next.defaultCategoryId;
    updatePrefs.mutate(next);
  };

  return (
    <ContentTab
      categories={categories}
      onUpdateCategories={(next) => updateCategories.mutate(next)}
      faviconApi={faviconApi}
      defaultCategoryId={defaultCategoryId}
      onSetDefault={handleSetDefault}
    />
  );
};

export default ContentPage;
